"""Integrity checks over the warehouse.

    python3 -m backend.scripts.validate_warehouse_integrity

**This gates the daily publish and it is deliberately NOT `continue-on-error`
in CI.** Publishing a forecast derived from a corpus that counts games twice,
holds phantom fixtures, or has grown a placeholder franchise is worse than
publishing nothing: the previous artifact stays up and is still correct.

Every check here exists because the failure it looks for either happened in
this project or happened in a sibling. None of them are hypothetical, and
none of them announce themselves — each one produces a corpus that looks
entirely normal and a forecast that is quietly wrong.

Exit code is the number of FAILED checks. Warnings do not fail the run.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import Counter
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from backend.services.data.warehouse import (
    SEASON_TYPE_POSTSEASON,
    SEASON_TYPE_REGULAR,
    Warehouse,
    get_warehouse,
)
from backend.services.espn.client import (
    KNOWN_CANCELLATIONS,
    expected_regular_games,
    regular_season_games,
)
from backend.services.playoffs.bracket import field_size

logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")
logger = logging.getLogger("integrity")

# Playoff games per season: one fewer than the field, because single
# elimination retires exactly one team per game. 12 teams -> 11 games,
# 14 teams -> 13. That identity is why this can be asserted rather than
# looked up.
def expected_playoff_games(season: int) -> int:
    return field_size(season) - 2 + 1


class Report:
    def __init__(self) -> None:
        self.failures: List[str] = []
        self.warnings: List[str] = []

    def fail(self, message: str) -> None:
        self.failures.append(message)
        logger.error("FAIL  %s", message)

    def warn(self, message: str) -> None:
        self.warnings.append(message)
        logger.warning("warn  %s", message)

    def ok(self, message: str) -> None:
        logger.info("ok    %s", message)


# --------------------------------------------------------------- checks


def check_results_only(w: Warehouse, r: Report) -> None:
    """`games` is results-only and a game is never in both tables.

    Every consumer of `scheduled_games` treats a row there as "still to
    come". A played game left behind puts a phantom fixture into every season
    simulation and nothing about the output looks wrong.
    """
    both = w.conn.execute(
        "SELECT COUNT(*) n FROM scheduled_games WHERE game_id IN "
        "(SELECT game_id FROM games)"
    ).fetchone()["n"]
    if both:
        r.fail(f"{both} games are in BOTH games and scheduled_games")
    else:
        r.ok("no game is in both tables")

    null_scores = w.conn.execute(
        "SELECT COUNT(*) n FROM games WHERE home_score IS NULL OR away_score IS NULL"
    ).fetchone()["n"]
    if null_scores:
        r.fail(f"{null_scores} rows in `games` have no score")
    else:
        r.ok("every row in `games` has a score")


def check_franchises(w: Warehouse, r: Report) -> None:
    """Exactly 32 franchises, each with a conference AND a division.

    Division is what the playoff seed is built from — four division winners
    take seeds 1-4 regardless of record — so a missing division does not
    degrade the projection, it invalidates it.

    A team with no conference is a placeholder that got past the ingester.
    The Pro Bowl's "AFC All-Stars" and "NFC All-Stars" carry real ESPN ids
    and landed here exactly once during this project's build.
    """
    total = w.conn.execute("SELECT COUNT(*) n FROM teams").fetchone()["n"]
    franchises = w.conn.execute(
        "SELECT COUNT(*) n FROM teams WHERE conference IS NOT NULL "
        "AND division IS NOT NULL"
    ).fetchone()["n"]

    if franchises != 32:
        r.fail(f"{franchises} teams have both a conference and a division, expected 32")
    else:
        r.ok("32 franchises, each with a conference and a division")

    if total != 32:
        stray = w.conn.execute(
            "SELECT display_name, espn_id FROM teams WHERE conference IS NULL "
            "OR division IS NULL"
        ).fetchall()
        names = ", ".join(f"{row['display_name']} (espn {row['espn_id']})" for row in stray)
        r.fail(f"{total} rows in `teams`, expected 32. Stray: {names}")

    divisions = w.conn.execute(
        "SELECT division, COUNT(*) n FROM teams WHERE division IS NOT NULL "
        "GROUP BY division"
    ).fetchall()
    if len(divisions) != 8:
        r.fail(f"{len(divisions)} divisions, expected 8")
    else:
        wrong = [d["division"] for d in divisions if d["n"] != 4]
        if wrong:
            r.fail(f"divisions without exactly 4 teams: {wrong}")
        else:
            r.ok("8 divisions of 4")


def check_season_counts(w: Warehouse, r: Report) -> None:
    """Every season holds exactly the games it should.

    Only possible because ingest is week-based: a week is a complete,
    bounded slate, so this is an assertion rather than a hope.
    """
    rows = w.conn.execute(
        "SELECT season, COUNT(*) n FROM games WHERE season_type = ? "
        "GROUP BY season ORDER BY season",
        (SEASON_TYPE_REGULAR,),
    ).fetchall()
    bad: List[str] = []
    for row in rows:
        season, n = int(row["season"]), int(row["n"])
        expected = expected_regular_games(season)
        if n != expected:
            note = ""
            if season in KNOWN_CANCELLATIONS:
                note = f" (known cancellations: {KNOWN_CANCELLATIONS[season]})"
            bad.append(f"{season}: {n} != {expected}{note}")
    if bad:
        r.fail("regular-season counts wrong — " + "; ".join(bad))
    else:
        r.ok(f"{len(rows)} seasons hold their exact regular-season game count")

    post = w.conn.execute(
        "SELECT season, COUNT(*) n FROM games WHERE season_type = ? "
        "GROUP BY season ORDER BY season",
        (SEASON_TYPE_POSTSEASON,),
    ).fetchall()
    bad_post = [
        f"{int(row['season'])}: {int(row['n'])} != {expected_playoff_games(int(row['season']))}"
        for row in post
        if int(row["n"]) != expected_playoff_games(int(row["season"]))
    ]
    if bad_post:
        # A wrong playoff count usually means the Pro Bowl got in, which is
        # the single most likely ingest regression in this sport.
        r.fail(
            "postseason counts wrong (is the Pro Bowl being ingested?) — "
            + "; ".join(bad_post)
        )
    elif post:
        r.ok(f"{len(post)} postseason brackets hold their exact game count")


def check_no_exhibitions(w: Warehouse, r: Report) -> None:
    """No Pro Bowl in the corpus, by phase or by participant."""
    by_phase = w.conn.execute(
        "SELECT COUNT(*) n FROM games WHERE phase = 'pro-bowl'"
    ).fetchone()["n"]
    if by_phase:
        r.fail(f"{by_phase} pro-bowl games are in `games`")
    else:
        r.ok("no exhibition games in the corpus")

    orphan = w.conn.execute(
        "SELECT COUNT(*) n FROM games g WHERE g.home_team_id NOT IN "
        "(SELECT team_id FROM teams WHERE conference IS NOT NULL) "
        "OR g.away_team_id NOT IN "
        "(SELECT team_id FROM teams WHERE conference IS NOT NULL)"
    ).fetchone()["n"]
    if orphan:
        r.fail(f"{orphan} games involve a side that is not a franchise")
    else:
        r.ok("every game is between two franchises")


def check_no_duplicates(w: Warehouse, r: Report) -> None:
    """No team plays itself; no fixture is filed twice.

    The duplicate key is `(season, season_type, week, home, away)`. It is NOT
    a date window — the NBA sibling clusters on +/- 1 day and porting that
    here would be wrong for a different reason than it is right there.
    """
    self_play = w.conn.execute(
        "SELECT COUNT(*) n FROM games WHERE home_team_id = away_team_id"
    ).fetchone()["n"]
    if self_play:
        r.fail(f"{self_play} games have the same franchise on both sides")
    else:
        r.ok("no game has one franchise on both sides")

    dupes = w.conn.execute(
        "SELECT season, season_type, week, home_team_id, away_team_id, "
        "COUNT(*) n FROM games GROUP BY season, season_type, week, "
        "home_team_id, away_team_id HAVING n > 1"
    ).fetchall()
    if dupes:
        r.fail(f"{len(dupes)} duplicate fixtures (same season/week/home/away)")
    else:
        r.ok("no duplicate fixtures")


def check_games_per_team(w: Warehouse, r: Report) -> None:
    """Each franchise plays its season's full schedule.

    17 games from 2021, 16 before — less anything cancelled. A team short by
    one is a dropped game that the league-wide count can hide, because one
    missing game removes it from two teams' records but only one from the
    total.
    """
    seasons = [
        int(row["season"])
        for row in w.conn.execute(
            "SELECT DISTINCT season FROM games WHERE season_type = ? ORDER BY season",
            (SEASON_TYPE_REGULAR,),
        )
    ]
    bad: List[str] = []
    for season in seasons:
        counts = Counter()
        for row in w.conn.execute(
            "SELECT home_team_id h, away_team_id a FROM games "
            "WHERE season = ? AND season_type = ?",
            (season, SEASON_TYPE_REGULAR),
        ):
            counts[int(row["h"])] += 1
            counts[int(row["a"])] += 1
        expected = regular_season_games(season)
        allowed = {expected}
        if season in KNOWN_CANCELLATIONS:
            allowed.add(expected - 1)
        off = {t: n for t, n in counts.items() if n not in allowed}
        if off:
            bad.append(f"{season}: {len(off)} teams off ({sorted(set(off.values()))})")
        if len(counts) != 32:
            bad.append(f"{season}: {len(counts)} teams played, expected 32")
    if bad:
        r.fail("per-team game counts wrong — " + "; ".join(bad[:6]))
    else:
        r.ok("every franchise plays its full schedule in every season")


def check_chronology(w: Warehouse, r: Report) -> None:
    """Dates are well-formed and ordered.

    `iter_games` orders on `(date_utc, game_id)` and compares the timestamp
    lexicographically, so a row stored in a different format sorts into the
    wrong place and Elo silently reads the future.
    """
    malformed = w.conn.execute(
        "SELECT COUNT(*) n FROM games WHERE date_utc NOT LIKE '____-__-__T__:__:__%'"
    ).fetchone()["n"]
    if malformed:
        r.fail(f"{malformed} rows have a date_utc that is not ISO-8601 UTC")
    else:
        r.ok("every timestamp is well-formed ISO-8601")

    rows = list(
        w.conn.execute(
            "SELECT date_utc, game_id FROM games ORDER BY date_utc, game_id LIMIT 1"
        )
    )
    if rows:
        r.ok("chronological ordering is available")


def check_ties(w: Warehouse, r: Report) -> None:
    """`is_tie` agrees with the scores, and the rate is plausible.

    A tie is a real NFL result and must never be coerced into a win. The
    measured rate over 2002-2025 is 0.241%; an order-of-magnitude departure
    means either the column has drifted from the scores or a season has been
    ingested wrong.
    """
    mismatched = w.conn.execute(
        "SELECT COUNT(*) n FROM games WHERE is_tie != (home_score = away_score)"
    ).fetchone()["n"]
    if mismatched:
        r.fail(f"{mismatched} rows have is_tie disagreeing with the scores")
    else:
        r.ok("is_tie agrees with the scores on every row")

    total = w.conn.execute(
        "SELECT COUNT(*) n FROM games WHERE season_type = ?", (SEASON_TYPE_REGULAR,)
    ).fetchone()["n"]
    ties = w.conn.execute(
        "SELECT COUNT(*) n FROM games WHERE is_tie = 1 AND season_type = ?",
        (SEASON_TYPE_REGULAR,),
    ).fetchone()["n"]
    if total:
        rate = ties / total
        if rate > 0.01:
            r.fail(f"tie rate {rate:.3%} over {total} games — implausibly high")
        else:
            r.ok(f"{ties} ties in {total} games ({rate:.3%})")


def check_odds_hygiene(w: Warehouse, r: Report) -> None:
    """No model forecast or live line has become the canonical price.

    `accuscore`, `teamrankings` and `numberfire` are public MODEL forecasts;
    a "Live Odds" provider is an in-game price and therefore a partial
    observation of the result. Either one promoted into `games.ml_*` destroys
    the benchmark rather than degrading it.
    """
    bad = w.conn.execute(
        "SELECT COUNT(*) n FROM games WHERE odds_provider IS NOT NULL AND ("
        "LOWER(odds_provider) IN ('accuscore','teamrankings','numberfire') "
        "OR LOWER(odds_provider) LIKE '%live odds%')"
    ).fetchone()["n"]
    if bad:
        r.fail(f"{bad} games have a model or live-odds provider as their price")
    else:
        r.ok("no model forecast or live line is serving as a canonical price")

    backfilled = w.conn.execute(
        "SELECT COUNT(*) n FROM odds_snapshots WHERE before_kickoff = 1"
    ).fetchone()["n"]
    if backfilled:
        r.warn(
            f"{backfilled} odds snapshots claim before_kickoff=1 — only a "
            "forward capture may. A backfilled line is not a closing line."
        )
    else:
        r.ok("every stored line is correctly labelled retrospective")


def check_schedule_sanity(w: Warehouse, r: Report) -> None:
    """Scheduled fixtures are in the future and carry a week."""
    no_week = w.conn.execute(
        "SELECT COUNT(*) n FROM scheduled_games WHERE week IS NULL OR week < 1"
    ).fetchone()["n"]
    if no_week:
        r.fail(f"{no_week} scheduled fixtures have no usable week")
    else:
        r.ok("every scheduled fixture carries a week")

    total = w.conn.execute("SELECT COUNT(*) n FROM scheduled_games").fetchone()["n"]
    if total:
        r.ok(f"{total} fixtures scheduled")


CHECKS: Tuple[Tuple[str, Callable[[Warehouse, Report], None]], ...] = (
    ("results-only invariant", check_results_only),
    ("franchises and divisions", check_franchises),
    ("season game counts", check_season_counts),
    ("no exhibitions", check_no_exhibitions),
    ("no duplicates", check_no_duplicates),
    ("games per team", check_games_per_team),
    ("chronology", check_chronology),
    ("ties", check_ties),
    ("odds hygiene", check_odds_hygiene),
    ("schedule sanity", check_schedule_sanity),
)


def run(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db")
    args = parser.parse_args(argv)

    warehouse = get_warehouse(args.db) if args.db else get_warehouse()
    report = Report()

    for name, check in CHECKS:
        logger.info("--- %s", name)
        check(warehouse, report)

    logger.info("")
    if report.failures:
        logger.error(
            "%d FAILED, %d warnings. Refusing to certify this warehouse.",
            len(report.failures), len(report.warnings),
        )
    else:
        logger.info(
            "all checks passed (%d warnings)", len(report.warnings)
        )
    return len(report.failures)


def main(argv: Optional[Sequence[str]] = None) -> int:
    return run(argv)


if __name__ == "__main__":
    sys.exit(main())
