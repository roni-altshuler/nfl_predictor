"""SQLite-backed game warehouse.

The warehouse is the single source of truth for historical NFL data. Every
external source (ESPN scoreboard, ESPN summary/boxscore, ESPN core-api odds)
writes canonical rows here, and every model reads features from joins over
these tables — never from the original JSON caches.

Design choices, ported from the sibling NBA and soccer projects. The
divergences below are deliberate and each one is a fact about football rather
than a preference:

* **Pure stdlib `sqlite3`.** No ORM. Inspectable from the `sqlite3` CLI.
* **Idempotent migrations.** `Warehouse.migrate()` is safe on every process
  start.
* **Upsert semantics** keyed on `game_id`, so re-running a loader cannot
  create duplicates.
* **Team identity is ESPN's integer id, not a name.** Inherited from the NBA
  project, and for the same reason: 32 stable franchises and one source, so
  there is no fuzzy path to get wrong. ESPN's `team.id` survives relocations
  (Oakland/Las Vegas Raiders are both id 13; San Diego/Los Angeles Chargers
  are both 24; St. Louis/Los Angeles Rams are both 14). Names are stored for
  display and are explicitly NOT a join key.
* **`games` is results-only.** A row here is a fact about a game that was
  played. Scheduled-but-unplayed games live in `scheduled_games`. This
  invariant is what lets every consumer read a row without a null check, and
  it is guarded by `validate_warehouse_integrity`.

Three things differ from the NBA warehouse
------------------------------------------

1. **`week` is a first-class, NOT-NULL column on both game tables.** Football
   is played in discrete weeks, ESPN indexes on them, and every product
   surface here (the schedule, the projection, the "rest of season" split) is
   organised by week rather than by date. Deriving a week from a date after
   the fact is guesswork the moment a game is flexed to a different day, and
   the international games in London kick off on a UTC date that belongs to
   the previous week's Sunday in every US timezone.

2. **A tie is a real result, and there is a dedicated column for it.** NBA
   overtime resolves every game — the sibling project asserts zero ties in
   27,690 games and builds its whole probability model on P(margin=0) = 0.
   NFL regular-season overtime does NOT resolve every game. Ties are rare but
   they are not zero, and a model that assumes they cannot happen will
   silently score one as a loss for both sides. `is_tie` is stored rather
   than computed so the integrity checker can count them without a scan, and
   the three-outcome handling lives in `market.py`.

3. **`postseason_round` replaces `series_id`.** The NBA plays best-of-seven
   series and needs an object to accumulate them into. The NFL plays single
   elimination: one game IS the round. Storing a series id here would be
   modelling a thing that does not exist.

Schema
------
* `teams(team_id, espn_id, display_name, abbreviation, conference, division,
   logo, venue_name)`
* `team_aliases(alias PRIMARY KEY, team_id)` — historical names
  ("Oakland Raiders", "San Diego Chargers") resolving to the surviving row
* `competitions(competition_id PRIMARY KEY, name, level)`
* `games(game_id PRIMARY KEY, source, competition_id, season, season_type,
   week, date_utc, home_team_id, away_team_id, home_score, away_score,
   home_q1..home_q4, home_ot, away_q1..away_q4, away_ot, is_tie, went_overtime,
   neutral_site, venue, attendance, phase, postseason_round,
   plus box-score columns, plus closing-market columns)`
* `scheduled_games(...)` — same shape, no scores
* `elo_ratings(team_id, date, elo, PRIMARY KEY(team_id, date))`
* `odds_snapshots(game_id, provider, captured_at, ...)` — append-only
* `prediction_snapshots(fixture_uid, generated_at, model_version, ...)`
* `schema_version(version, applied_at)`
"""

from __future__ import annotations

import logging
import re
import sqlite3
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

WAREHOUSE_PATH = (
    Path(__file__).resolve().parent.parent.parent / "data" / "warehouse.sqlite"
)

# v1: teams/games/scheduled_games/elo_ratings/odds_snapshots.
# v2: prediction_snapshots (append-only forecast provenance).
SCHEMA_VERSION = 2

# Season type ids, ESPN's own. Kept as integers because that is what the
# scoreboard payload carries; named here so no call site writes a bare 2.
SEASON_TYPE_PRESEASON = 1
SEASON_TYPE_REGULAR = 2
SEASON_TYPE_POSTSEASON = 3
SEASON_TYPE_OFFSEASON = 4

SEASON_TYPE_NAMES = {
    SEASON_TYPE_PRESEASON: "preseason",
    SEASON_TYPE_REGULAR: "regular-season",
    SEASON_TYPE_POSTSEASON: "post-season",
    SEASON_TYPE_OFFSEASON: "off-season",
}

# Phases written to `games.phase`.
#
# `pro-bowl` exists as a phase even though the loader currently refuses the
# game (its sides are conference squads, not franchises — see `espn_loader`).
# The phase is kept because `iter_games` filters on it: if a future format
# ever fields real franchises in an exhibition, it gets labelled and excluded
# rather than silently joining the corpus. A filter that only works because
# its target happens to be absent is not a filter.
PHASE_REGULAR = "regular"
PHASE_PRESEASON = "preseason"
PHASE_PRO_BOWL = "pro-bowl"

_DDL_STATEMENTS: Tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS teams (
        team_id INTEGER PRIMARY KEY AUTOINCREMENT,
        espn_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        short_name TEXT,
        abbreviation TEXT,
        conference TEXT,
        division TEXT,
        logo TEXT,
        color TEXT,
        venue_name TEXT,
        first_seen TEXT,
        last_seen TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS team_aliases (
        alias TEXT PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS competitions (
        competition_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        level TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS games (
        game_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        competition_id TEXT NOT NULL REFERENCES competitions(competition_id),
        season INTEGER NOT NULL,
        season_type INTEGER NOT NULL,
        week INTEGER NOT NULL,
        date_utc TEXT NOT NULL,
        home_team_id INTEGER NOT NULL REFERENCES teams(team_id),
        away_team_id INTEGER NOT NULL REFERENCES teams(team_id),
        home_score INTEGER NOT NULL,
        away_score INTEGER NOT NULL,
        home_q1 INTEGER, home_q2 INTEGER, home_q3 INTEGER, home_q4 INTEGER,
        home_ot INTEGER,
        away_q1 INTEGER, away_q2 INTEGER, away_q3 INTEGER, away_q4 INTEGER,
        away_ot INTEGER,
        -- A tie is a real NFL result. Stored, not derived, so the integrity
        -- checker can count them and so no consumer has to remember that
        -- `home_score > away_score` is not the complement of a home loss.
        is_tie INTEGER NOT NULL DEFAULT 0,
        went_overtime INTEGER NOT NULL DEFAULT 0,
        neutral_site INTEGER NOT NULL DEFAULT 0,
        venue TEXT,
        attendance INTEGER,
        phase TEXT,
        postseason_round TEXT,
        -- Team box score, home side. Football stats, not basketball ones.
        home_first_downs REAL, home_total_yards REAL, home_pass_yards REAL,
        home_rush_yards REAL, home_turnovers REAL, home_penalties REAL,
        home_penalty_yards REAL, home_third_down_att REAL,
        home_third_down_conv REAL, home_possession_sec REAL,
        home_sacks REAL, home_plays REAL,
        -- Team box score, away side
        away_first_downs REAL, away_total_yards REAL, away_pass_yards REAL,
        away_rush_yards REAL, away_turnovers REAL, away_penalties REAL,
        away_penalty_yards REAL, away_third_down_att REAL,
        away_third_down_conv REAL, away_possession_sec REAL,
        away_sacks REAL, away_plays REAL,
        -- Closing market, from the ESPN CORE api (never pickcenter, which is
        -- empty for this sport). moneyline is AMERICAN odds.
        ml_home REAL, ml_away REAL, spread_home REAL, total_points REAL,
        odds_provider TEXT,
        fetched_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS scheduled_games (
        game_id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        competition_id TEXT NOT NULL REFERENCES competitions(competition_id),
        season INTEGER NOT NULL,
        season_type INTEGER NOT NULL,
        week INTEGER NOT NULL,
        date_utc TEXT NOT NULL,
        home_team_id INTEGER NOT NULL REFERENCES teams(team_id),
        away_team_id INTEGER NOT NULL REFERENCES teams(team_id),
        neutral_site INTEGER NOT NULL DEFAULT 0,
        venue TEXT,
        phase TEXT,
        postseason_round TEXT,
        ml_home REAL, ml_away REAL, spread_home REAL, total_points REAL,
        odds_provider TEXT,
        fetched_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS elo_ratings (
        team_id INTEGER NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        elo REAL NOT NULL,
        PRIMARY KEY (team_id, date)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS odds_snapshots (
        game_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        ml_home REAL, ml_away REAL, spread_home REAL, spread_odds_home REAL,
        spread_odds_away REAL, total_points REAL, over_odds REAL,
        under_odds REAL,
        -- 0 for anything backfilled: asking ESPN today for a 2016 line
        -- returns whatever it kept, with no timestamp saying when it was
        -- current. A backfilled line is not a closing line.
        before_kickoff INTEGER NOT NULL DEFAULT 1,
        -- 'price' for a real book, 'model' for a public forecast vendor
        -- (accuscore, teamrankings, numberfire). Merging the two destroys
        -- the benchmark, so the distinction is stored, not inferred later.
        kind TEXT NOT NULL DEFAULT 'price',
        PRIMARY KEY (game_id, provider, captured_at)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS prediction_snapshots (
        fixture_uid TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        model_version TEXT NOT NULL,
        competition_id TEXT,
        season INTEGER,
        week INTEGER,
        kickoff_utc TEXT,
        home_team TEXT,
        away_team TEXT,
        p_home REAL,
        p_away REAL,
        p_tie REAL,
        exp_margin REAL,
        exp_total REAL,
        PRIMARY KEY (fixture_uid, generated_at, model_version)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_games_date ON games(date_utc)",
    "CREATE INDEX IF NOT EXISTS idx_games_season ON games(season, season_type, week)",
    "CREATE INDEX IF NOT EXISTS idx_games_home ON games(home_team_id)",
    "CREATE INDEX IF NOT EXISTS idx_games_away ON games(away_team_id)",
    "CREATE INDEX IF NOT EXISTS idx_sched_date ON scheduled_games(date_utc)",
    "CREATE INDEX IF NOT EXISTS idx_sched_season ON scheduled_games(season, season_type, week)",
    "CREATE INDEX IF NOT EXISTS idx_elo_date ON elo_ratings(date)",
    "CREATE INDEX IF NOT EXISTS idx_odds_game ON odds_snapshots(game_id)",
)


# Columns on `games` that a loader may write. Named explicitly so that adding
# a column to the DDL without teaching the writer about it is a visible
# omission rather than a silent NULL.
GAME_COLUMNS: Tuple[str, ...] = (
    "game_id", "source", "competition_id", "season", "season_type", "week",
    "date_utc", "home_team_id", "away_team_id", "home_score", "away_score",
    "home_q1", "home_q2", "home_q3", "home_q4", "home_ot",
    "away_q1", "away_q2", "away_q3", "away_q4", "away_ot",
    "is_tie", "went_overtime", "neutral_site", "venue", "attendance", "phase",
    "postseason_round",
    "home_first_downs", "home_total_yards", "home_pass_yards",
    "home_rush_yards", "home_turnovers", "home_penalties",
    "home_penalty_yards", "home_third_down_att", "home_third_down_conv",
    "home_possession_sec", "home_sacks", "home_plays",
    "away_first_downs", "away_total_yards", "away_pass_yards",
    "away_rush_yards", "away_turnovers", "away_penalties",
    "away_penalty_yards", "away_third_down_att", "away_third_down_conv",
    "away_possession_sec", "away_sacks", "away_plays",
    "ml_home", "ml_away", "spread_home", "total_points", "odds_provider",
    "fetched_at",
)

SCHEDULED_COLUMNS: Tuple[str, ...] = (
    "game_id", "source", "competition_id", "season", "season_type", "week",
    "date_utc", "home_team_id", "away_team_id", "neutral_site", "venue",
    "phase", "postseason_round", "ml_home", "ml_away", "spread_home",
    "total_points", "odds_provider", "fetched_at",
)


@dataclass
class GameRow:
    """One played game, canonicalised.

    `home_score`/`away_score` are required and non-null by construction —
    see the module docstring on why `games` is results-only.
    """

    game_id: str
    source: str
    competition_id: str
    season: int
    season_type: int
    week: int
    date_utc: str
    home_team_id: int
    away_team_id: int
    home_score: int
    away_score: int
    extra: Dict[str, Any] = field(default_factory=dict)

    def as_params(self) -> Dict[str, Any]:
        row: Dict[str, Any] = {c: None for c in GAME_COLUMNS}
        row.update(
            game_id=self.game_id,
            source=self.source,
            competition_id=self.competition_id,
            season=self.season,
            season_type=self.season_type,
            week=self.week,
            date_utc=self.date_utc,
            home_team_id=self.home_team_id,
            away_team_id=self.away_team_id,
            home_score=self.home_score,
            away_score=self.away_score,
            # Derived once, here, so no consumer has to remember to.
            is_tie=1 if int(self.home_score) == int(self.away_score) else 0,
            went_overtime=0,
            neutral_site=0,
            fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
        for key, value in self.extra.items():
            if key in row:
                row[key] = value
            else:  # a typo in a loader is a bug, not a column to invent
                raise KeyError(f"{key!r} is not a column on `games`")
        return row


@dataclass
class ScheduledGameRow:
    """One scheduled-but-unplayed game."""

    game_id: str
    source: str
    competition_id: str
    season: int
    season_type: int
    week: int
    date_utc: str
    home_team_id: int
    away_team_id: int
    extra: Dict[str, Any] = field(default_factory=dict)

    def as_params(self) -> Dict[str, Any]:
        row: Dict[str, Any] = {c: None for c in SCHEDULED_COLUMNS}
        row.update(
            game_id=self.game_id,
            source=self.source,
            competition_id=self.competition_id,
            season=self.season,
            season_type=self.season_type,
            week=self.week,
            date_utc=self.date_utc,
            home_team_id=self.home_team_id,
            away_team_id=self.away_team_id,
            neutral_site=0,
            fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
        for key, value in self.extra.items():
            if key in row:
                row[key] = value
            else:
                raise KeyError(f"{key!r} is not a column on `scheduled_games`")
        return row


class Warehouse:
    """Thin, synchronous wrapper around the SQLite game warehouse."""

    def __init__(self, path: Optional[Path] = None):
        self.path = Path(path) if path else WAREHOUSE_PATH
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()

    # ---------------------------------------------------------------- conn

    @property
    def conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(str(self.path), timeout=30.0)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA journal_mode = WAL")
            self._local.conn = conn
        return conn

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        conn = self.conn
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    def close(self) -> None:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
            self._local.conn = None

    # ------------------------------------------------------------ migrate

    def migrate(self) -> int:
        with self.transaction() as conn:
            for stmt in _DDL_STATEMENTS:
                conn.execute(stmt)
            row = conn.execute(
                "SELECT MAX(version) AS v FROM schema_version"
            ).fetchone()
            current = row["v"] if row and row["v"] is not None else 0
            if current < SCHEMA_VERSION:
                conn.execute(
                    "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
                    (
                        SCHEMA_VERSION,
                        datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    ),
                )
        return SCHEMA_VERSION

    # -------------------------------------------------------------- teams

    def upsert_team(
        self,
        espn_id: str,
        display_name: str,
        *,
        short_name: Optional[str] = None,
        abbreviation: Optional[str] = None,
        conference: Optional[str] = None,
        division: Optional[str] = None,
        logo: Optional[str] = None,
        color: Optional[str] = None,
        venue_name: Optional[str] = None,
        seen: Optional[str] = None,
    ) -> int:
        """Insert or update a franchise, keyed on ESPN's stable team id.

        Only non-None arguments overwrite an existing value. A later
        scoreboard row must not blank out the conference/division that a
        standings pull established — and division is the single field the
        entire playoff seeding depends on.
        """
        espn_id = str(espn_id)
        with self.transaction() as conn:
            existing = conn.execute(
                "SELECT team_id FROM teams WHERE espn_id = ?", (espn_id,)
            ).fetchone()
            if existing is None:
                cur = conn.execute(
                    """
                    INSERT INTO teams (espn_id, display_name, short_name,
                        abbreviation, conference, division, logo, color,
                        venue_name, first_seen, last_seen)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (espn_id, display_name, short_name, abbreviation,
                     conference, division, logo, color, venue_name, seen, seen),
                )
                team_id = int(cur.lastrowid)
                conn.execute(
                    "INSERT OR IGNORE INTO team_aliases (alias, team_id) VALUES (?, ?)",
                    (_norm(display_name), team_id),
                )
                return team_id

            team_id = int(existing["team_id"])
            sets, params = [], []
            for col, val in (
                ("display_name", display_name),
                ("short_name", short_name),
                ("abbreviation", abbreviation),
                ("conference", conference),
                ("division", division),
                ("logo", logo),
                ("color", color),
                ("venue_name", venue_name),
            ):
                if val is not None:
                    sets.append(f"{col} = ?")
                    params.append(val)
            if seen:
                sets.append(
                    "first_seen = CASE WHEN first_seen IS NULL OR first_seen > ? "
                    "THEN ? ELSE first_seen END"
                )
                params.extend([seen, seen])
                sets.append(
                    "last_seen = CASE WHEN last_seen IS NULL OR last_seen < ? "
                    "THEN ? ELSE last_seen END"
                )
                params.extend([seen, seen])
            if sets:
                params.append(team_id)
                conn.execute(
                    f"UPDATE teams SET {', '.join(sets)} WHERE team_id = ?", params
                )
            if display_name:
                conn.execute(
                    "INSERT OR IGNORE INTO team_aliases (alias, team_id) VALUES (?, ?)",
                    (_norm(display_name), team_id),
                )
            return team_id

    def team_id_for_espn(self, espn_id: str) -> Optional[int]:
        row = self.conn.execute(
            "SELECT team_id FROM teams WHERE espn_id = ?", (str(espn_id),)
        ).fetchone()
        return int(row["team_id"]) if row else None

    def team_id_for_name(self, name: str) -> Optional[int]:
        """Resolve a display name through the alias table only.

        Deliberately exact-after-normalisation: there is no fuzzy path,
        because with 32 franchises and one source there is nothing a fuzzy
        match could buy that an alias row cannot, and a wrong merge here
        would corrupt a franchise's entire record.
        """
        row = self.conn.execute(
            "SELECT team_id FROM team_aliases WHERE alias = ?", (_norm(name),)
        ).fetchone()
        return int(row["team_id"]) if row else None

    def add_alias(self, alias: str, team_id: int) -> None:
        with self.transaction() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO team_aliases (alias, team_id) VALUES (?, ?)",
                (_norm(alias), team_id),
            )

    def teams(self) -> List[sqlite3.Row]:
        return list(self.conn.execute("SELECT * FROM teams ORDER BY display_name"))

    def franchises(self) -> List[sqlite3.Row]:
        """The 32 teams that have a conference.

        A franchise is a team with a conference, read from ESPN's standings.
        This is the participation filter the sibling projects use to keep
        exhibition sides out of a 32-team table, and it is why the Pro Bowl's
        "AFC"/"NFC" sides can never contaminate a standings query.
        """
        return list(
            self.conn.execute(
                "SELECT * FROM teams WHERE conference IS NOT NULL "
                "ORDER BY conference, division, display_name"
            )
        )

    # ------------------------------------------------------- competitions

    def upsert_competition(
        self, competition_id: str, name: str, level: Optional[str] = None
    ) -> None:
        with self.transaction() as conn:
            conn.execute(
                """
                INSERT INTO competitions (competition_id, name, level)
                VALUES (?,?,?)
                ON CONFLICT(competition_id) DO UPDATE SET name=excluded.name,
                    level=COALESCE(excluded.level, competitions.level)
                """,
                (competition_id, name, level),
            )

    # -------------------------------------------------------------- games

    def upsert_games(self, rows: Iterable[GameRow]) -> int:
        rows = list(rows)
        if not rows:
            return 0
        cols = ", ".join(GAME_COLUMNS)
        placeholders = ", ".join(f":{c}" for c in GAME_COLUMNS)
        # COALESCE on update so a scoreboard pass (no box score) cannot blank
        # the box score a later summary pass wrote. Score, date and week
        # always win from the newest row — a corrected final is a correction,
        # and a flexed game genuinely does move.
        always_wins = {
            "home_score", "away_score", "date_utc", "week", "season_type",
            "is_tie", "source", "fetched_at",
        }
        updates = ", ".join(
            f"{c}=excluded.{c}" if c in always_wins
            else f"{c}=COALESCE(excluded.{c}, games.{c})"
            for c in GAME_COLUMNS
            if c != "game_id"
        )
        sql = (
            f"INSERT INTO games ({cols}) VALUES ({placeholders}) "
            f"ON CONFLICT(game_id) DO UPDATE SET {updates}"
        )
        with self.transaction() as conn:
            conn.executemany(sql, [r.as_params() for r in rows])
        return len(rows)

    def upsert_scheduled(self, rows: Iterable[ScheduledGameRow]) -> int:
        rows = list(rows)
        if not rows:
            return 0
        cols = ", ".join(SCHEDULED_COLUMNS)
        placeholders = ", ".join(f":{c}" for c in SCHEDULED_COLUMNS)
        updates = ", ".join(
            f"{c}=excluded.{c}" for c in SCHEDULED_COLUMNS if c != "game_id"
        )
        sql = (
            f"INSERT INTO scheduled_games ({cols}) VALUES ({placeholders}) "
            f"ON CONFLICT(game_id) DO UPDATE SET {updates}"
        )
        with self.transaction() as conn:
            conn.executemany(sql, [r.as_params() for r in rows])
        return len(rows)

    def drop_scheduled(self, game_ids: Sequence[str]) -> int:
        """Remove scheduled rows for games that now have a result."""
        if not game_ids:
            return 0
        with self.transaction() as conn:
            conn.executemany(
                "DELETE FROM scheduled_games WHERE game_id = ?",
                [(g,) for g in game_ids],
            )
        return len(game_ids)

    def prune_played_from_scheduled(self) -> int:
        """Enforce the "never in both tables" invariant.

        Runs in the same pass that files a result. A played game left in
        `scheduled_games` puts a phantom fixture into every season simulation
        and nothing about the output looks wrong.
        """
        with self.transaction() as conn:
            cur = conn.execute(
                "DELETE FROM scheduled_games WHERE game_id IN (SELECT game_id FROM games)"
            )
            return cur.rowcount or 0

    def iter_games(
        self,
        *,
        seasons: Optional[Sequence[int]] = None,
        season_types: Optional[Sequence[int]] = (SEASON_TYPE_REGULAR,),
        since: Optional[str] = None,
        until: Optional[str] = None,
        competition_id: Optional[str] = None,
        exclude_exhibitions: bool = True,
    ) -> Iterator[sqlite3.Row]:
        """Yield played games in chronological order.

        Ordering is `(date_utc, game_id)` and every caller that slices the
        result positionally must use this same ordering. The soccer project
        lost a whole benchmark to a split that re-sorted by a different key
        and then indexed positionally into the original.

        `exclude_exhibitions` drops the Pro Bowl by PHASE. It defaults to
        True because every statistical consumer wants it gone, and the one
        surface that wants it (the Pro Bowl archive page) asks for it
        explicitly.
        """
        where, params = ["1=1"], []
        if seasons:
            where.append(f"season IN ({','.join('?' * len(seasons))})")
            params.extend(seasons)
        if season_types:
            where.append(f"season_type IN ({','.join('?' * len(season_types))})")
            params.extend(season_types)
        if since:
            where.append("date_utc >= ?")
            params.append(since)
        if until:
            where.append("date_utc <= ?")
            params.append(until)
        if competition_id:
            where.append("competition_id = ?")
            params.append(competition_id)
        if exclude_exhibitions:
            where.append("(phase IS NULL OR phase != ?)")
            params.append(PHASE_PRO_BOWL)
        sql = (
            f"SELECT * FROM games WHERE {' AND '.join(where)} "
            f"ORDER BY date_utc, game_id"
        )
        yield from self.conn.execute(sql, params)

    def iter_scheduled(
        self,
        *,
        seasons: Optional[Sequence[int]] = None,
        season_types: Optional[Sequence[int]] = None,
        since: Optional[str] = None,
        exclude_exhibitions: bool = True,
    ) -> Iterator[sqlite3.Row]:
        where, params = ["1=1"], []
        if seasons:
            where.append(f"season IN ({','.join('?' * len(seasons))})")
            params.extend(seasons)
        if season_types:
            where.append(f"season_type IN ({','.join('?' * len(season_types))})")
            params.extend(season_types)
        if since:
            where.append("date_utc >= ?")
            params.append(since)
        if exclude_exhibitions:
            where.append("(phase IS NULL OR phase != ?)")
            params.append(PHASE_PRO_BOWL)
        sql = (
            f"SELECT * FROM scheduled_games WHERE {' AND '.join(where)} "
            f"ORDER BY date_utc, game_id"
        )
        yield from self.conn.execute(sql, params)

    # ---------------------------------------------------------------- elo

    def write_elo(self, rows: Iterable[Tuple[int, str, float]]) -> int:
        rows = list(rows)
        if not rows:
            return 0
        with self.transaction() as conn:
            conn.executemany(
                "INSERT OR REPLACE INTO elo_ratings (team_id, date, elo) VALUES (?,?,?)",
                rows,
            )
        return len(rows)

    def latest_elo(self, team_id: int, before: Optional[str] = None) -> Optional[float]:
        """The last rating strictly BEFORE `before`.

        Ratings are POST-game values timestamped at kickoff, so "strictly
        earlier" is what makes a feature point-in-time correct. Using `<=`
        here leaks the result of the game being predicted.
        """
        if before:
            row = self.conn.execute(
                "SELECT elo FROM elo_ratings WHERE team_id = ? AND date < ? "
                "ORDER BY date DESC LIMIT 1",
                (team_id, before),
            ).fetchone()
        else:
            row = self.conn.execute(
                "SELECT elo FROM elo_ratings WHERE team_id = ? "
                "ORDER BY date DESC LIMIT 1",
                (team_id,),
            ).fetchone()
        return float(row["elo"]) if row else None

    # --------------------------------------------------------------- odds

    def write_odds_snapshots(self, rows: Iterable[Dict[str, Any]]) -> int:
        prepared = [
            (
                str(r["game_id"]), str(r["provider"]), str(r["captured_at"]),
                _as_float(r.get("ml_home")), _as_float(r.get("ml_away")),
                _as_float(r.get("spread_home")),
                _as_float(r.get("spread_odds_home")),
                _as_float(r.get("spread_odds_away")),
                _as_float(r.get("total_points")), _as_float(r.get("over_odds")),
                _as_float(r.get("under_odds")),
                int(r.get("before_kickoff", 1)),
                str(r.get("kind", "price")),
            )
            for r in rows
        ]
        if not prepared:
            return 0
        with self.transaction() as conn:
            conn.executemany(
                "INSERT OR REPLACE INTO odds_snapshots (game_id, provider, "
                "captured_at, ml_home, ml_away, spread_home, spread_odds_home, "
                "spread_odds_away, total_points, over_odds, under_odds, "
                "before_kickoff, kind) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                prepared,
            )
        return len(prepared)

    # ------------------------------------------------- forecast provenance

    def record_predictions(self, rows: Iterable[Dict[str, Any]]) -> int:
        """Append what the model said, before the game was played.

        **This is the only thing on disk that can distinguish a published
        forecast from a backtest.** `game_forecasts.json` is overwritten every
        morning, so without these rows the record of what was claimed in
        advance survives exactly one day. Everything else could be recomputed
        later from the corpus — and a recomputed forecast is a backtest by
        this project's own definition, however carefully it is done.
        """
        prepared = [
            (
                str(row["fixture_uid"]),
                str(row["generated_at"]),
                str(row["model_version"]),
                row.get("competition_id"),
                row.get("season"),
                row.get("week"),
                row.get("kickoff_utc"),
                row.get("home_team"),
                row.get("away_team"),
                _as_float(row.get("p_home")),
                _as_float(row.get("p_away")),
                _as_float(row.get("p_tie")),
                _as_float(row.get("exp_margin")),
                _as_float(row.get("exp_total")),
            )
            for row in rows
        ]
        if not prepared:
            return 0
        with self.transaction() as conn:
            conn.executemany(
                "INSERT OR REPLACE INTO prediction_snapshots ("
                "fixture_uid, generated_at, model_version, competition_id, "
                "season, week, kickoff_utc, home_team, away_team, p_home, "
                "p_away, p_tie, exp_margin, exp_total) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                prepared,
            )
        return len(prepared)

    def earliest_predictions(self, season: Optional[int] = None) -> List[sqlite3.Row]:
        """The FIRST forecast published for each fixture, strictly pre-kickoff.

        Strictly `generated_at < kickoff_utc`: a snapshot written after the
        game started is not a forecast, whatever it says.
        """
        sql = (
            "SELECT * FROM prediction_snapshots p WHERE generated_at = ("
            "  SELECT MIN(generated_at) FROM prediction_snapshots q "
            "  WHERE q.fixture_uid = p.fixture_uid "
            "    AND q.generated_at < q.kickoff_utc"
            ") AND generated_at < kickoff_utc"
        )
        params: List[Any] = []
        if season is not None:
            sql += " AND season = ?"
            params.append(season)
        return list(self.conn.execute(sql, params))

    # ------------------------------------------------------------- counts

    def count(self, table: str) -> int:
        if table not in {
            "games", "scheduled_games", "teams", "elo_ratings",
            "odds_snapshots", "prediction_snapshots", "team_aliases",
        }:
            raise ValueError(f"{table!r} is not a warehouse table")
        row = self.conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()
        return int(row["n"])

    def season_range(self) -> Tuple[Optional[int], Optional[int]]:
        row = self.conn.execute(
            "SELECT MIN(season) AS lo, MAX(season) AS hi FROM games"
        ).fetchone()
        return (
            int(row["lo"]) if row and row["lo"] is not None else None,
            int(row["hi"]) if row and row["hi"] is not None else None,
        )


_ws = re.compile(r"\s+")


def _norm(name: str) -> str:
    """Normalise a display name for the alias table."""
    return _ws.sub(" ", str(name or "").strip().lower())


def _as_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


_warehouse: Optional[Warehouse] = None


def get_warehouse(path: Optional[Path] = None) -> Warehouse:
    global _warehouse
    if _warehouse is None or path is not None:
        _warehouse = Warehouse(path)
        _warehouse.migrate()
    return _warehouse
