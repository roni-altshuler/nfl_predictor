"""Score the forecasts that were published BEFORE their kickoffs.

    python3 -m backend.scripts.score_live

Writes `backend/data/predictions/forecast_log.json`.

**This is the only surface in the project that can claim a number existed
before its result did.** Everything else — the walk-forward benchmark, the
whole `/accuracy` table — is a reconstruction. Those reconstructions are done
honestly, refit on games strictly earlier than the one they score, so the
model never saw the answer. But nobody READ those numbers before those
kickoffs either, and the distinction is the difference between "this model
would have said" and "this model did say".

The record here starts at zero and grows one week at a time. It is reported
at whatever n it has reached and **is never merged with the historical
walk-forward**, however tempting a larger sample is.

How a forecast qualifies
------------------------

`forecast_season` appends a row to `prediction_snapshots` every time it runs.
A row counts here only if:

1. `generated_at < kickoff_utc` — strictly. A snapshot written after the game
   started is not a forecast, whatever it says.
2. It is the EARLIEST such row for that fixture. The publisher runs daily, so
   a game gets forecast many times as it approaches; taking the latest would
   quietly grade the model on its best-informed guess and call it a
   prediction. `Warehouse.earliest_predictions` enforces both conditions in
   SQL rather than in a filter someone can forget.
3. The game has since been played, and was decided. Ties are excluded and
   counted, exactly as in the historical benchmark.

The `forecast_log.json` artifact is committed to git deliberately: the
warehouse is gitignored and rebuilt from ESPN on a failed restore, and **a
forecast made before a game is the one thing a rebuild cannot recover.**
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from backend.services.data.warehouse import Warehouse, get_warehouse
from backend.services.espn.client import current_season
from backend.services.prediction import market as mkt

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s"
)
logger = logging.getLogger("score_live")

OUT = Path(__file__).resolve().parent.parent / "data" / "predictions"


def assert_history_preserved(prior, candidate):
    """Fail closed on missing/replaced forecasts, while allowing score corrections."""
    if candidate['forecasts_made'] < prior.get('forecasts_made',0):
        raise ValueError('Forecast history shrank; restore the published warehouse before scoring')
    current = {g['game_id']:g for g in candidate['games']}
    fields = ('generated_at','model_version','home','away','p_home','p_tie','p_away','exp_margin')
    for old in prior.get('games',[]):
        new = current.get(old['game_id'])
        if new is None or any(new.get(k) != old.get(k) for k in fields):
            raise ValueError('Published forecast disappeared or changed; refusing to replace live record')


def run(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, default=None)
    parser.add_argument("--db")
    args = parser.parse_args(argv)

    season = args.season or current_season()
    warehouse: Warehouse = get_warehouse(args.db) if args.db else get_warehouse()

    snapshots = warehouse.earliest_predictions(season)
    logger.info(
        "%d fixtures have a strictly pre-kickoff forecast for %s",
        len(snapshots), season,
    )

    graded: List[Dict[str, Any]] = []
    pending = 0
    invalid = 0

    for snapshot in snapshots:
        row = warehouse.conn.execute(
            "SELECT home_score, away_score, week, date_utc FROM games "
            "WHERE game_id = ?",
            (str(snapshot["fixture_uid"]),),
        ).fetchone()
        if row is None:
            pending += 1
            continue

        home_score = int(row["home_score"])
        away_score = int(row["away_score"])
        try:
            p_home, p_tie, p_away = [float(snapshot[k]) for k in ('p_home','p_tie','p_away')]
            generated = datetime.fromisoformat(snapshot['generated_at'].replace('Z','+00:00'))
            actual_kickoff = datetime.fromisoformat(row['date_utc'].replace('Z','+00:00'))
            if (not all(math.isfinite(p) and 0 <= p <= 1 for p in (p_home,p_tie,p_away))
                or abs(p_home+p_tie+p_away-1) > 0.00001 or p_home+p_away <= 0
                or generated.tzinfo is None or actual_kickoff.tzinfo is None
                or generated >= actual_kickoff):
                raise ValueError('invalid probability or post-kickoff forecast')
        except (ValueError, TypeError):
            invalid += 1
            continue

        entry: Dict[str, Any] = {
            "game_id": str(snapshot["fixture_uid"]),
            "season": season,
            "week": snapshot["week"],
            "kickoff_utc": snapshot["kickoff_utc"],
            "generated_at": snapshot["generated_at"],
            "model_version": snapshot["model_version"],
            "horizon_hours": round((actual_kickoff-generated).total_seconds()/3600, 2),
            "home": snapshot["home_team"],
            "away": snapshot["away_team"],
            "p_home": round(p_home, 6),
            "p_tie": round(p_tie, 6),
            "p_away": round(p_away, 6),
            "exp_margin": snapshot["exp_margin"],
            "home_score": home_score,
            "away_score": away_score,
            "tie": home_score == away_score,
        }

        if home_score != away_score:
            # Conditioned, for the same reason the benchmark conditions: the
            # published triple allocates tie mass and a win/loss outcome does
            # not.
            conditional = mkt.conditional_from_three(p_home, p_tie, p_away)[0]
            won = home_score > away_score
            entry["p_home_conditional"] = round(conditional, 6)
            entry["brier"] = round(mkt.brier_score(conditional, won), 6)
            entry["log_loss"] = round(mkt.log_loss(conditional, won), 6)
            entry["correct"] = (conditional >= 0.5) == won

        graded.append(entry)

    decided = [g for g in graded if not g["tie"]]
    ties = len(graded) - len(decided)

    summary: Dict[str, Any] = {
        "season": season,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "basis": "published",
        "forecasts_made": len(snapshots),
        "games_played": len(graded),
        "games_pending": pending,
        "ties_excluded": ties,
        "invalid_excluded": invalid,
        "n": len(decided),
        "note": (
            "Every row here was published strictly before its kickoff and is "
            "the EARLIEST such publication for that fixture. This record is "
            "never merged with the historical walk-forward on /accuracy, "
            "which is a reconstruction."
        ),
    }

    if decided:
        summary["brier"] = round(
            sum(g["brier"] for g in decided) / len(decided), 5
        )
        summary["accuracy"] = round(
            sum(1 for g in decided if g["correct"]) / len(decided), 5
        )
        summary["ece"] = round(
            mkt.expected_calibration_error(
                [g["p_home_conditional"] for g in decided],
                [g["home_score"] > g["away_score"] for g in decided],
            ),
            5,
        )
        logger.info(
            "live record: n=%d brier %.5f accuracy %.4f ece %.5f (%d ties excluded)",
            len(decided), summary["brier"], summary["accuracy"],
            summary["ece"], ties,
        )
    else:
        # Not an error. The season has not started, or has not finished a
        # week. An empty record is a fact and renders as one.
        logger.info(
            "no decided games with a pre-kickoff forecast yet — "
            "the live record is empty and says so"
        )

    def cohort(games):
        return {"n":len(games), "brier":round(sum(g['brier'] for g in games)/len(games),5) if games else None,
                "log_loss":round(sum(g['log_loss'] for g in games)/len(games),5) if games else None,
                "accuracy":round(sum(g['correct'] for g in games)/len(games),5) if games else None}
    summary['cohorts'] = {
        'model_version': {v:cohort([g for g in decided if g['model_version']==v]) for v in sorted({g['model_version'] for g in decided})},
        'horizon': {label:cohort([g for g in decided if low <= g['horizon_hours'] < high])
                    for label,low,high in [('under_24h',0,24),('1_to_7_days',24,168),('7_days_or_more',168,float('inf'))]},
    }
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "forecast_log.json"
    if path.exists():
        prior = json.loads(path.read_text())
        if prior.get('season') == season:
            assert_history_preserved(prior, {**summary, 'games':graded})
        else:
            archive = OUT / f"forecast_log_{prior['season']}.json"
            if not archive.exists():
                archive.write_text(json.dumps(prior, indent=2, allow_nan=False))
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({**summary, "games": graded}, indent=2, allow_nan=False))
    tmp.replace(path)
    logger.info("wrote %s", path.name)
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    return run(argv)


if __name__ == "__main__":
    sys.exit(main())
