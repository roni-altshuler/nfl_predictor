"""Build (or refresh) the NFL game warehouse from ESPN.

    python3 -m backend.scripts.build_warehouse --seasons 2002-2026
    python3 -m backend.scripts.build_warehouse --current-season
    python3 -m backend.scripts.build_warehouse --all

Ingest is **week by week**, not by date range. That is the whole design: a
week is a complete, bounded, independently verifiable slate, so this script
can assert that a finished regular season holds exactly 272 games (256 before
2021) instead of hoping a date range came back whole. See `espn/client.py`.

A season costs 23-24 requests (18 regular weeks + 5 postseason), so the full
2002-2026 corpus is roughly 600 requests and a few minutes.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from typing import List, Optional, Sequence

from backend.services.data.espn_loader import ESPNLoader
from backend.services.data.warehouse import (
    SEASON_TYPE_REGULAR,
    Warehouse,
    get_warehouse,
)
from backend.services.espn.client import (
    ESPNClient,
    current_season,
    expected_regular_games,
    get_espn_client,
)

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s"
)
logger = logging.getLogger("build_warehouse")

# The first season this project claims, and it is a structural choice rather
# than a convenience. **2002 is when the NFL realigned to 32 teams in eight
# four-team divisions** — the Houston Texans' first season. Every season from
# then to now has the same shape, the same playoff structure (modulo the 2020
# expansion to seven seeds) and the same division-winner seeding rule.
#
# Before 2002 there were 31 teams in six divisions of uneven size, and the
# seeding rules differ. ESPN answers those seasons happily and they would
# quietly join the corpus as if nothing had changed.
EARLIEST_SEASON = 2002


def parse_seasons(spec: str) -> List[int]:
    """`2016-2026` or `2016,2018,2020` → a list of season labels."""
    out: List[int] = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            lo, _, hi = part.partition("-")
            out.extend(range(int(lo), int(hi) + 1))
        else:
            out.append(int(part))
    return sorted(set(out))


async def ingest_season(
    client: ESPNClient,
    loader: ESPNLoader,
    warehouse: Warehouse,
    season: int,
    *,
    include_preseason: bool,
) -> dict:
    events = await client.get_season_events(
        season, include_preseason=include_preseason, use_cache=False
    )
    stats = loader.load_events(events)

    # Completeness check, which is only possible because ingest is week-based.
    played = warehouse.conn.execute(
        "SELECT COUNT(*) AS n FROM games WHERE season = ? AND season_type = ?",
        (season, SEASON_TYPE_REGULAR),
    ).fetchone()["n"]
    scheduled = warehouse.conn.execute(
        "SELECT COUNT(*) AS n FROM scheduled_games WHERE season = ? AND season_type = ?",
        (season, SEASON_TYPE_REGULAR),
    ).fetchone()["n"]
    expected = expected_regular_games(season)
    total = played + scheduled

    note = ""
    if total != expected:
        note = f"  ** {total} regular-season rows, expected {expected} **"

    logger.info(
        "season %s: %d events → %d games, %d scheduled, %d skipped "
        "(regular: %d played + %d upcoming = %d/%d)%s",
        season, len(events), stats["games"], stats["scheduled"], stats["skipped"],
        played, scheduled, total, expected, note,
    )
    return {**stats, "complete": total == expected}


async def run(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seasons", help="e.g. 2016-2026 or 2019,2021")
    parser.add_argument(
        "--current-season", action="store_true", help="refresh the season in progress"
    )
    parser.add_argument(
        "--all", action="store_true", help=f"every season from {EARLIEST_SEASON}"
    )
    parser.add_argument(
        "--preseason", action="store_true",
        help="also ingest preseason games (stored, never modelled)",
    )
    parser.add_argument("--db", help="warehouse path override")
    args = parser.parse_args(argv)

    seasons: List[int]
    if args.seasons:
        seasons = parse_seasons(args.seasons)
    elif args.current_season:
        seasons = [current_season()]
    elif args.all:
        seasons = list(range(EARLIEST_SEASON, current_season() + 1))
    else:
        parser.error("one of --seasons / --current-season / --all is required")
        return 2

    warehouse: Warehouse = get_warehouse(args.db) if args.db else get_warehouse()
    loader = ESPNLoader(warehouse)
    client = get_espn_client()

    try:
        teams = await client.get_teams()
        logger.info("registered %d franchises", loader.register_teams(teams))

        # level=3 or the divisions are simply absent — and the playoff seed is
        # built from division winners, so a missing division does not degrade
        # the projection, it invalidates it.
        standings = await client.get_standings(level=3)
        divisions_set = loader.apply_standings(standings) if standings else 0
        if divisions_set < 32:
            logger.error(
                "only %d teams got a division from standings — the seeding "
                "layer needs all 32. Check that level=3 is being sent.",
                divisions_set,
            )
        else:
            logger.info("conference + division set for %d teams", divisions_set)

        totals = {"games": 0, "scheduled": 0, "skipped": 0, "pruned": 0}
        incomplete: List[int] = []
        for season in seasons:
            stats = await ingest_season(
                client, loader, warehouse, season,
                include_preseason=args.preseason,
            )
            for key in totals:
                totals[key] += stats.get(key, 0)
            if not stats["complete"]:
                incomplete.append(season)
    finally:
        await client.close()

    logger.info("TOTAL written: %s", totals)
    logger.info("skips by reason: %s", loader.skip_report())
    logger.info(
        "warehouse: %d games, %d scheduled, %d teams",
        warehouse.count("games"),
        warehouse.count("scheduled_games"),
        warehouse.count("teams"),
    )
    if incomplete:
        logger.error("SEASONS WITH AN UNEXPECTED GAME COUNT: %s", incomplete)
        return 1
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    return asyncio.run(run(argv))


if __name__ == "__main__":
    sys.exit(main())
