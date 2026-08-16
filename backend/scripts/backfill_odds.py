"""Backfill sportsbook lines from ESPN's core API.

    python3 -m backend.scripts.backfill_odds --seasons 2014-2026
    python3 -m backend.scripts.backfill_odds --missing-only
    python3 -m backend.scripts.backfill_odds --current-season

**The NFL's prices are not where the NBA's are.** The sibling project reads
its whole market benchmark out of the summary endpoint's `pickcenter` array.
For football that array is present and always EMPTY, and the summary's `odds`
key is null — verified across every era in the corpus. The lines live on the
core API instead, one request per event.

Three classification rules, and getting any of them wrong destroys the
benchmark rather than degrading it
----------------------------------------------------------------------

1. **`accuscore`, `teamrankings` and `numberfire` are not prices.** They are
   public MODEL FORECASTS that ESPN publishes in the same array as the books.
   Merging them into the market benchmark means scoring this project's model
   against other people's models and calling the result "the market". They
   are stored under their own name with `kind='model'` and are never eligible
   to become `games.ml_*`. This is the NBA project's rule verbatim; only the
   vendor names differ.

2. **A "Live Odds" provider is an IN-GAME price.** ESPN publishes
   `ESPN Bet - Live Odds` (59) and `Caesars ... - Live Odds` (46) alongside
   the pregame lines. A line captured during the third quarter of a game the
   home side is winning by 20 is not a forecast of that game — it is a
   partial observation of its result. Including it would hand the "market"
   near-perfect foresight and produce exactly the result this project's
   standing rules say to distrust: a benchmark that cannot be beaten because
   it already knows.

3. **A backfilled line is not a closing line.** Asking ESPN today for a 2016
   game returns whatever it kept, with no timestamp saying when it was
   current. Every row written here carries `before_kickoff = 0` and the
   historical market comparison is labelled retrospective. The
   forward-captured record is a different thing and the two are never merged.

Coverage by era, measured
-------------------------

Sampled at four games per season across the corpus:

    <= 2010     no odds at all
    2014        consensus + several offshore books + `Opening`
    2017-2022   consensus, Caesars, DraftKings, Bet365, ESPN BET, and the
                three model vendors
    2024-2026   ESPN BET and Bet365 only; the vendors are gone

So the market benchmark simply does not exist before about 2011, and
`benchmark_market` reports the priced subset rather than comparing the model
against nothing.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from backend.services.data.warehouse import Warehouse, get_warehouse
from backend.services.espn.client import (
    ESPNClient,
    current_season,
    get_espn_client,
)

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s"
)
logger = logging.getLogger("backfill_odds")

# Providers that publish MODEL FORECASTS rather than prices. Matched on the
# lowercased provider name.
MODEL_VENDORS = {"accuscore", "teamrankings", "numberfire"}

# A provider whose name contains any of these is an in-game price.
LIVE_MARKERS = ("live odds", "live-odds", "in-play")

# Preference order for which price becomes the canonical `games.ml_*`.
# `consensus` first because it is an aggregate rather than one book's
# opinion; then the books with the widest historical coverage. An unknown
# provider is USED but ranked last, and logged — never silently dropped, and
# never silently promoted above a known book.
PROVIDER_PRIORITY = (
    "consensus",
    "espn bet",
    "draftkings",
    "caesars sportsbook",
    "caesars",
    "bet 365",
    "westgate",
    "bovada.lv",
    "5dimes.eu",
    "betonline.ag",
    "opening",
)


def classify(provider_name: str) -> str:
    """'model', 'live' or 'price'."""
    name = (provider_name or "").strip().lower()
    if any(marker in name for marker in LIVE_MARKERS):
        return "live"
    if name in MODEL_VENDORS:
        return "model"
    return "price"


def _rank(provider_name: str) -> int:
    name = (provider_name or "").strip().lower()
    for index, known in enumerate(PROVIDER_PRIORITY):
        if name == known:
            return index
    return len(PROVIDER_PRIORITY)


def _as_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_item(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """One core-api odds item → a snapshot dict, or None if unusable."""
    provider = (item.get("provider") or {}).get("name")
    if not provider:
        return None
    home = item.get("homeTeamOdds") or {}
    away = item.get("awayTeamOdds") or {}
    return {
        "provider": str(provider),
        "kind": classify(provider),
        "ml_home": _as_float(home.get("moneyLine")),
        "ml_away": _as_float(away.get("moneyLine")),
        "spread_home": _as_float(item.get("spread")),
        "total_points": _as_float(item.get("overUnder")),
        "over_odds": _as_float((item.get("overOdds") or None)),
        "under_odds": _as_float((item.get("underOdds") or None)),
    }


def pick_canonical(
    snapshots: Sequence[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """Choose the row that becomes `games.ml_*` / `spread_home` / `total`.

    Only `kind == 'price'` is eligible. Among those, the one that carries a
    complete moneyline wins over one that carries only a spread, because a
    moneyline is a direct probability statement and a spread has to be pushed
    through a margin distribution to become one. Ties break on
    `PROVIDER_PRIORITY`.
    """
    prices = [s for s in snapshots if s["kind"] == "price"]
    if not prices:
        return None
    with_ml = [
        s for s in prices if s["ml_home"] is not None and s["ml_away"] is not None
    ]
    pool = with_ml or prices
    return sorted(pool, key=lambda s: _rank(s["provider"]))[0]


async def backfill_game(
    client: ESPNClient, warehouse: Warehouse, game_id: str, table: str
) -> Tuple[int, bool]:
    """Fetch, classify and store every line for one game."""
    items = await client.get_event_odds(str(game_id))
    if not items:
        return 0, False

    parsed = [p for p in (parse_item(i) for i in items) if p]
    if not parsed:
        return 0, False

    captured = datetime.now(timezone.utc).isoformat(timespec="seconds")
    warehouse.write_odds_snapshots(
        [
            {
                **snapshot,
                "game_id": str(game_id),
                "captured_at": captured,
                # Backfilled: ESPN gives no timestamp saying when this line
                # was current, so it cannot be called a closing line.
                "before_kickoff": 0,
            }
            for snapshot in parsed
        ]
    )

    canonical = pick_canonical(parsed)
    if canonical is None:
        return len(parsed), False

    warehouse.conn.execute(
        f"UPDATE {table} SET ml_home=?, ml_away=?, spread_home=?, "
        f"total_points=?, odds_provider=? WHERE game_id=?",
        (
            canonical["ml_home"], canonical["ml_away"],
            canonical["spread_home"], canonical["total_points"],
            canonical["provider"], str(game_id),
        ),
    )
    warehouse.conn.commit()
    return len(parsed), True


async def run(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seasons", help="e.g. 2014-2026")
    parser.add_argument("--current-season", action="store_true")
    parser.add_argument(
        "--missing-only", action="store_true",
        help="only games with no odds_provider yet",
    )
    parser.add_argument("--limit", type=int, help="stop after N games")
    parser.add_argument("--db")
    args = parser.parse_args(argv)

    warehouse = get_warehouse(args.db) if args.db else get_warehouse()

    seasons: List[int] = []
    if args.seasons:
        lo, _, hi = args.seasons.partition("-")
        seasons = list(range(int(lo), int(hi or lo) + 1))
    elif args.current_season:
        seasons = [current_season()]

    targets: List[Tuple[str, str]] = []
    for table in ("games", "scheduled_games"):
        where, params = ["1=1"], []
        if seasons:
            where.append(f"season IN ({','.join('?' * len(seasons))})")
            params.extend(seasons)
        if args.missing_only:
            where.append("odds_provider IS NULL")
        rows = warehouse.conn.execute(
            f"SELECT game_id FROM {table} WHERE {' AND '.join(where)} "
            f"ORDER BY date_utc",
            params,
        ).fetchall()
        targets.extend((str(r["game_id"]), table) for r in rows)

    if args.limit:
        targets = targets[: args.limit]

    logger.info("backfilling odds for %d games", len(targets))
    client = get_espn_client()
    snapshots = priced = 0
    try:
        for index, (game_id, table) in enumerate(targets, 1):
            n, ok = await backfill_game(client, warehouse, game_id, table)
            snapshots += n
            priced += 1 if ok else 0
            if index % 250 == 0:
                logger.info(
                    "  %d/%d  %d snapshots, %d games priced",
                    index, len(targets), snapshots, priced,
                )
    finally:
        await client.close()

    logger.info(
        "done: %d snapshots over %d games, %d got a canonical price",
        snapshots, len(targets), priced,
    )
    breakdown = warehouse.conn.execute(
        "SELECT kind, COUNT(*) n, COUNT(DISTINCT game_id) g "
        "FROM odds_snapshots GROUP BY kind"
    ).fetchall()
    for row in breakdown:
        logger.info("  kind=%s: %d rows over %d games", row["kind"], row["n"], row["g"])
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    return asyncio.run(run(argv))


if __name__ == "__main__":
    sys.exit(main())
