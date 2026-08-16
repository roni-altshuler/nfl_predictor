"""ESPN API client for NFL data.

Provides schedules, scores, box scores, standings, team metadata and — via a
*different host from everything else here* — the sportsbook lines that are
this project's market benchmark.

Three things about these hosts are load-bearing. The first two are inherited
verbatim from the sibling NBA and soccer projects, where they each cost a
production outage. The third is new here and is the single biggest ingestion
difference between this project and its siblings.

1. **Use `site.web.api.espn.com`, never `site.api.espn.com`.** The two serve
   byte-identical payloads. Akamai answers `site.api` with 403 Access Denied
   from datacentre IPs (Vercel, GitHub Actions) and its error page carries no
   CORS headers, so a browser fetch dies with `net::ERR_FAILED`. The host is
   named once here and once in `src/lib/espnHost.ts`. Do not hardcode it
   anywhere else.

2. **The scoreboard silently caps at a page of events.** No error, no field
   saying so. Any call that could span more than a page must pass an explicit
   `limit`, or it returns a prefix and nothing says so.

3. **NFL games are addressed by (season, season_type, week) — NOT by date.**
   The NBA project fetches date ranges because basketball plays a rolling
   calendar. Football does not: it plays in discrete weeks, ESPN indexes on
   them, and `?dates=YYYY&seasontype=N&week=W` returns exactly that week's
   slate — 16 games, complete, every time. Fetching football by date range
   works but is strictly worse: it straddles the Thursday/Sunday/Monday split,
   it has no natural chunk size, and it gives you no way to assert
   completeness. Here a week that does not return the expected count is a
   loud error rather than a silent short read. **Do not port the NBA's
   `get_scoreboard_range` into this project.**

**`pickcenter` is empty for the NFL.** The NBA project reads its entire
market benchmark out of the summary endpoint's `pickcenter` array. For
football that array exists and is always length zero, and the summary's
`odds` key is null. The prices live on the *core* API instead, under
`competitions/{id}/odds` — a different host, a different shape, and a
provider list that mixes real books with public model forecasts. See
`get_event_odds` below and `services/prediction/market.py` for the split.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# ESPN's own sport/league slugs. `nfl` is the only league this project serves;
# the others are named so a future wave does not have to rediscover them.
ESPN_LEAGUE_IDS = {
    "nfl": "football/nfl",
    "college": "football/college-football",
    "ufl": "football/ufl",
}

# The competition ids used inside the warehouse. Kept distinct from ESPN's
# slug so a source change does not rewrite every row.
NFL_COMPETITION_ID = "nfl"
NFL_PLAYOFFS_COMPETITION_ID = "nfl.playoffs"

# ESPN's season-type ids. Named here so no call site writes a bare 2.
SEASON_TYPE_PRESEASON = 1
SEASON_TYPE_REGULAR = 2
SEASON_TYPE_POSTSEASON = 3
SEASON_TYPE_OFFSEASON = 4

# The regular season has been 18 weeks since 2021 and was 17 before it.
# `regular_season_weeks` resolves it; these are the only two values that have
# ever applied in the 32-team era.
REGULAR_WEEKS_MODERN = 18       # 2021-, 17 games + 1 bye
REGULAR_WEEKS_LEGACY = 17       # 2002-2020, 16 games + 1 bye

# Postseason week numbering, which is NOT a bracket depth — and **the
# mapping is not even stable across eras.**
#
# From 2009 the Pro Bowl is postseason week 4 and the Super Bowl is week 5.
# Before 2009 the Pro Bowl was played the week AFTER the Super Bowl, in
# Hawaii, and ESPN files those seasons with **the Super Bowl as week 4** and
# no week 5 at all.
#
# The first version of this file hard-coded "week 4 is the Pro Bowl" and so
# refused the SUPER BOWL for every season from 2002 to 2008 — seven of them —
# while happily ingesting the Pro Bowl from 2009 onward under the label
# `super-bowl`. Nothing failed. It was caught by the integrity checker's
# postseason count, which expects `field_size - 1` games and found 10.
#
# So no calendar rule identifies the exhibition. **Participation does**, in
# every era: the Pro Bowl's sides are conference squads and are not among the
# league's 32 franchises. `ESPNLoader.franchise_ids` is the authority and the
# round map below is pure labelling, applied only to games that already
# passed that filter.
POSTSEASON_WILD_CARD = 1
POSTSEASON_DIVISIONAL = 2
POSTSEASON_CONFERENCE = 3

POSTSEASON_ROUNDS = {
    POSTSEASON_WILD_CARD: "wild-card",
    POSTSEASON_DIVISIONAL: "divisional",
    POSTSEASON_CONFERENCE: "conference",
}


def postseason_round(week: int) -> str:
    """Round slug for a postseason week, era-independently.

    Weeks 1-3 are the three conference rounds in every season. **Anything
    later is the Super Bowl** — week 4 before 2009, week 5 after — and this
    function never has to know which, because the Pro Bowl that sits between
    them is refused by participation before it reaches here.
    """
    return POSTSEASON_ROUNDS.get(int(week), "super-bowl")


class RateLimiter:
    """Token bucket rate limiter."""

    def __init__(self, requests_per_minute: int = 60):
        self.rate = requests_per_minute / 60.0
        self.tokens = float(requests_per_minute)
        self.max_tokens = float(requests_per_minute)
        self.last_update = time.time()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.time()
            elapsed = now - self.last_update
            self.tokens = min(self.max_tokens, self.tokens + elapsed * self.rate)
            self.last_update = now
            if self.tokens < 1:
                await asyncio.sleep((1 - self.tokens) / self.rate)
                self.tokens = 0.0
            else:
                self.tokens -= 1


class SimpleCache:
    """In-memory cache with TTL."""

    def __init__(self) -> None:
        self._cache: Dict[str, tuple[Any, float]] = {}

    def get(self, key: str) -> Optional[Any]:
        if key in self._cache:
            value, expiry = self._cache[key]
            if time.time() < expiry:
                return value
            del self._cache[key]
        return None

    def set(self, key: str, value: Any, ttl: int = 300) -> None:
        self._cache[key] = (value, time.time() + ttl)

    def clear(self) -> None:
        self._cache.clear()


class ESPNClient:
    """ESPN API client for NFL data."""

    HOST = "https://site.web.api.espn.com"
    BASE_URL = f"{HOST}/apis/site/v2/sports/football/nfl"
    V2_STANDINGS_URL = f"{HOST}/apis/v2/sports/football/nfl/standings"
    CORE_URL = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl"

    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
    }

    def __init__(self, requests_per_minute: int = 90):
        self.rate_limiter = RateLimiter(requests_per_minute)
        self.cache = SimpleCache()
        self.default_ttl = 300
        self.live_ttl = 30
        self._client: Optional[httpx.AsyncClient] = None
        self._client_loop: Optional[asyncio.AbstractEventLoop] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client.

        Recreated when the running event loop changes: sync entry points
        (CLI scripts, simulators) each spin up their own short-lived loop, and
        an AsyncClient bound to a closed loop fails every request with
        "Event loop is closed" without ever reporting itself as closed.
        """
        loop = asyncio.get_running_loop()
        if self._client is None or self._client.is_closed or self._client_loop is not loop:
            self._client = httpx.AsyncClient(
                headers=self.HEADERS, timeout=30.0, follow_redirects=True
            )
            self._client_loop = loop
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def _request(
        self,
        endpoint: str,
        params: Optional[Dict] = None,
        cache_key: Optional[str] = None,
        cache_ttl: Optional[int] = None,
        retries: int = 3,
    ) -> Optional[Dict]:
        if cache_key:
            cached = self.cache.get(cache_key)
            if cached is not None:
                return cached

        url = endpoint if endpoint.startswith("http") else f"{self.BASE_URL}/{endpoint}"

        for attempt in range(retries):
            await self.rate_limiter.acquire()
            try:
                client = await self._get_client()
                response = await client.get(url, params=params)
                response.raise_for_status()
                data = response.json()
                if cache_key:
                    self.cache.set(cache_key, data, cache_ttl or self.default_ttl)
                return data
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                # 404 is an answer ("no such event"), not a transient failure.
                if status == 404:
                    return None
                logger.warning("ESPN HTTP %s for %s (attempt %d)", status, url, attempt + 1)
            except httpx.RequestError as exc:
                logger.warning("ESPN request error for %s: %s", url, exc)
            except Exception as exc:  # noqa: BLE001 - last-resort guard
                logger.warning("ESPN unexpected error for %s: %s", url, exc)
            if attempt < retries - 1:
                await asyncio.sleep(1.5 * (attempt + 1))
        logger.error("ESPN gave up on %s after %d attempts", url, retries)
        return None

    # ------------------------------------------------------------ week

    async def get_week(
        self,
        season: int,
        week: int,
        *,
        season_type: int = SEASON_TYPE_REGULAR,
        limit: int = 100,
        use_cache: bool = True,
    ) -> List[Dict]:
        """Every event in one (season, season_type, week).

        **This is the unit of NFL ingestion.** A week is a complete, bounded,
        independently verifiable slate, which is what lets `build_warehouse`
        assert a count instead of hoping a range came back whole.

        `limit` is passed on every call for the reason in the module
        docstring, even though no NFL week has ever approached it.
        """
        params: Dict[str, Any] = {
            "dates": season,
            "seasontype": season_type,
            "week": week,
            "limit": limit,
        }
        key = f"nfl_wk_{season}_{season_type}_{week}" if use_cache else None
        data = await self._request("scoreboard", params, key, self.default_ttl)
        return (data or {}).get("events") or []

    async def get_season_events(
        self,
        season: int,
        *,
        include_preseason: bool = False,
        use_cache: bool = False,
    ) -> List[Dict]:
        """Every event in a season, week by week, de-duplicated on event id.

        Walks the regular season week range for that era plus the five
        postseason weeks. Preseason is **off by default**: those games are
        played by rosters that will not start the opener and including them in
        a rating is a measurable harm, not a neutral extra. `build_warehouse`
        can still ingest them for display.
        """
        seen: Dict[str, Dict] = {}
        plan: List[tuple[int, int]] = []

        if include_preseason:
            # Preseason is weeks 1-3 in the modern era (4 before 2021, when
            # the regular season took a week from it). Asking for a week that
            # does not exist returns an empty list, not an error.
            plan += [(SEASON_TYPE_PRESEASON, w) for w in range(1, 5)]

        plan += [
            (SEASON_TYPE_REGULAR, w)
            for w in range(1, regular_season_weeks(season) + 1)
        ]
        # All five postseason weeks are fetched, Pro Bowl included, because
        # refusing it at the FETCH is how you end up rediscovering it later.
        # It is refused at the loader, by phase, where the decision is
        # recorded.
        plan += [(SEASON_TYPE_POSTSEASON, w) for w in range(1, 6)]

        for season_type, week in plan:
            events = await self.get_week(
                season, week, season_type=season_type, use_cache=use_cache
            )
            for event in events:
                event_id = str(event.get("id") or "")
                if not event_id:
                    continue
                # Stamp the query that produced this row. ESPN echoes season
                # and week inside the payload, but not on every event, and a
                # postseason round is only knowable from the week that
                # returned it.
                event["_query"] = {
                    "season": season,
                    "season_type": season_type,
                    "week": week,
                }
                seen[event_id] = event

        return list(seen.values())

    async def get_summary(self, event_id: str, use_cache: bool = True) -> Optional[Dict]:
        """Full game detail: box score, drives, injuries, win probability."""
        return await self._request(
            "summary",
            {"event": event_id},
            f"nfl_summary_{event_id}" if use_cache else None,
            self.live_ttl,
        )

    # ------------------------------------------------------------- odds

    async def get_event_odds(self, event_id: str) -> List[Dict]:
        """Sportsbook lines for one event, from the CORE api.

        The NFL's prices are not where the NBA's are. `pickcenter` on the
        summary endpoint is present-but-empty for every football event tested,
        across every era, and the summary's `odds` key is null. The lines live
        here instead.

        Returns raw provider items. **Sorting the real books from the model
        forecasts is not this function's job** — it returns everything ESPN
        has and `backfill_odds` classifies it, so that the classification is
        recorded in one place rather than implied by a filter here.
        """
        url = f"{self.CORE_URL}/events/{event_id}/competitions/{event_id}/odds"
        data = await self._request(
            url, {"limit": 50}, f"nfl_odds_{event_id}", 600
        )
        return (data or {}).get("items") or []

    # -------------------------------------------------------- standings

    async def get_standings(
        self, season: Optional[int] = None, *, level: int = 3
    ) -> Optional[Dict]:
        """Conference and division standings.

        `level=3` is required to get DIVISIONS. At the default level the
        payload has two children (AFC, NFC) with sixteen flat entries each and
        no division grouping at all — which would quietly cost this project
        the four division winners per conference that the entire playoff seed
        depends on.
        """
        params: Dict[str, Any] = {"level": level}
        if season:
            params["season"] = season
        data = await self._request(
            self.V2_STANDINGS_URL,
            params,
            f"nfl_standings_{season or 'current'}_{level}",
            600,
        )
        if data and data.get("children"):
            return data
        return await self._request(
            "standings", params, f"nfl_standings_site_{season or 'current'}", 600
        )

    # ------------------------------------------------------------ teams

    async def get_teams(self) -> List[Dict]:
        data = await self._request("teams", {"limit": 50}, "nfl_teams", 3600)
        if not data:
            return []
        leagues = (data.get("sports") or [{}])[0].get("leagues") or [{}]
        return [entry.get("team", {}) for entry in (leagues[0].get("teams") or [])]

    async def get_team(self, team_id: str) -> Optional[Dict]:
        return await self._request(f"teams/{team_id}", cache_key=f"nfl_team_{team_id}")

    async def get_news(self, limit: int = 10) -> List[Dict]:
        data = await self._request("news", {"limit": limit}, f"nfl_news_{limit}", 900)
        return (data or {}).get("articles") or []


_client: Optional[ESPNClient] = None


def get_espn_client() -> ESPNClient:
    global _client
    if _client is None:
        _client = ESPNClient()
    return _client


async def cleanup_espn_client() -> None:
    global _client
    if _client:
        await _client.close()
        _client = None


# ------------------------------------------------------------- calendar


def regular_season_weeks(season: int) -> int:
    """How many regular-season weeks that season had.

    The NFL went from 16 games in 17 weeks to 17 games in 18 weeks in 2021.
    Hard-coding 18 silently invents a week for every season before it (which
    returns empty and looks like a bye); hard-coding 17 silently drops a real
    week of every season after it, which is 16 games that simply never appear
    and nothing reports missing.
    """
    return REGULAR_WEEKS_MODERN if season >= 2021 else REGULAR_WEEKS_LEGACY


def regular_season_games(season: int) -> int:
    """Games each team plays. 17 from 2021, 16 before."""
    return 17 if season >= 2021 else 16


# Regular-season games that were scheduled and never played, by season.
#
# **2022 is the only entry and it must stay documented rather than tolerated.**
# Buffalo at Cincinnati, 2 January 2023, was abandoned in the first quarter
# after Damar Hamlin suffered a cardiac arrest on the field. Unlike every
# other disrupted game in this corpus it was never resumed and never made up:
# the league cancelled it outright and declared it a no-contest, so both
# teams finished 2022 having played 16 games rather than 17.
#
# ESPN files it as `STATUS_CANCELED` and the loader correctly refuses it —
# it is neither a result nor a fixture. Without this entry the completeness
# check fails the whole build on a season that is genuinely complete, which
# trains you to ignore the check. With it, 271 is expected for 2022 and
# **271 in any other season is still an error**, which is the point.
KNOWN_CANCELLATIONS: Dict[int, int] = {
    2022: 1,
}


def expected_regular_games(season: int) -> int:
    """Total regular-season games actually played that season.

    32 teams x games / 2, less anything in `KNOWN_CANCELLATIONS`. Used by the
    integrity checker as a hard count: 272 in the modern era, 256 before.
    A season that does not hit its number exactly is a short read, not a
    quirk — and the one real exception is enumerated above rather than
    absorbed by a tolerance.
    """
    scheduled = 32 * regular_season_games(season) // 2
    return scheduled - KNOWN_CANCELLATIONS.get(season, 0)


def current_season(today: Optional[datetime] = None) -> int:
    """The season a forecast should be ABOUT, on ESPN's start-year convention.

    **The NFL labels a season by the year it STARTS, and the sibling NBA
    project labels one by the year it ENDS.** The 2026 NFL season kicks off
    in September 2026 and finishes with a Super Bowl in February 2027; the
    2026 NBA season finished in June 2026. The two conventions are opposite
    and the same integer means different things in the two warehouses. Do not
    port `current_season` across the projects.

    The rollover is **March**, just after the Super Bowl and the start of the
    league year. From March the season carrying the current calendar year is
    the one everybody wants a forecast for, even though it does not kick off
    for another six months — free agency and the draft are exactly when
    interest in a projection is highest.
    """
    now = today or datetime.now(timezone.utc)
    return now.year if now.month >= 3 else now.year - 1


def season_bounds(season: int) -> tuple[datetime, datetime]:
    """Calendar window that contains an NFL season.

    August of the labelled year (catching preseason) through to the end of
    the following February (catching the Super Bowl, which is always in the
    NEXT calendar year). The window straddling New Year is the whole reason
    this project indexes on weeks rather than dates.
    """
    start = datetime(season, 8, 1, tzinfo=timezone.utc)
    end = datetime(season + 1, 3, 1, tzinfo=timezone.utc)
    return start, end
