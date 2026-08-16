"""Point-in-time feature construction.

**The design rule is that a leak must be impossible, not merely absent.**

Every feature is emitted from rolling state that is updated *after* the row is
emitted. There is no query that could accidentally read forward, because
there is no query: the builder walks games in `(date_utc, game_id)` order,
hands out the vector, then folds the result in. The soccer project lost a
whole benchmark to a split that re-sorted by one key and indexed positionally
into another; the NBA project inherited this walk for the same reason.

`vector_for` is the SERVING path and `build` is the TRAINING path, and they
populate the same fields from the same state object. This is the single most
dangerous seam in the project and it has already produced a shipped bug in
the sibling: `forecast_season` there called `predict_from_elo`, which knows
only the rating gap, against a 19-feature model — so eighteen features fell
back to the intercept and the published expected total was 14.1 points in a
sport that scores 110. **It was caught only because the number was absurd.**

A football version of that bug would publish a total near 44 and a margin
near 2 and look completely reasonable. So the guard here cannot be "somebody
will notice": `dead_feature_blocks` compares the VARIANCE of each feature
between training and serving, not the names, because the NBA project's
version of this bug had matching names and differing values.

Football-specific features
--------------------------

* **Rest is a real signal here and is nearly meaningless in basketball.**
  The NBA project has no rest feature worth the name because every team plays
  every other day. Football teams play weekly, and the exceptions are large:
  a Thursday game is 4 days' rest, a normal week is 7, and a team off its bye
  has 13. Bye-week rest is the single largest scheduling edge in the sport.

* **Division games are played twice a season and are systematically closer.**
  Familiarity, divisional parity and the fact that a division rival is the
  one opponent a staff prepares for twice.

* **Rolling windows are short and cross season boundaries.** A 17-game
  season cannot support the 20-game windows the NBA project uses. The window
  here is the last 8 games of *football*, which for most of September means
  reaching back into last season — and that is deliberate: the alternative is
  a feature that is undefined for the first month of every year, which is
  exactly when a forecast is least anchored and most read.
"""

from __future__ import annotations

import logging
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Deque, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

logger = logging.getLogger(__name__)

# Rolling window, in games. Short because a season is 17 games; see the
# module docstring on why it deliberately spans the offseason.
WINDOW = 8

# Rest, in days. Genuine in-season values run 4 (Thursday game) through 7
# (normal week) to 13 (off a bye).
#
# **Anything beyond `OFFSEASON_GAP` is a season boundary, not rest**, and
# collapsing the two was a bug in the first version of this file that
# corrupted training and serving in the same way. The gap between a team's
# last game of one season and its opener in the next is 200-odd days. Clipped
# to REST_MAX it becomes 14, which reads as "maximally rested" — so every
# single week-1 game had BOTH teams flagged `off_bye`, in every season of the
# corpus. The flag therefore meant "week 1 or a real bye", the coefficient
# was fitted on that mixture, and nothing about the output looked wrong.
#
# It surfaced only because the serving path was 272 week-1-through-18
# fixtures whose rest was uniformly the offseason value, which made the
# feature constant and tripped `dead_feature_blocks`. A season opener is
# neither rested nor tired relative to its opponent — both sides have had the
# same summer — so it takes the neutral value and no bye flag.
REST_MIN = 3.0
REST_MAX = 14.0
REST_DEFAULT = 7.0
OFFSEASON_GAP = 30.0

# Days of rest at or above which a team is treated as coming off its bye.
# 12 rather than 13 because a Thursday game the week after a bye lands at 11,
# and a Monday game after one lands at 15.
BYE_THRESHOLD = 12.0

# The served feature set.
#
# **`elo_diff` deliberately EXCLUDES home advantage, and the venue indicator
# is `neutral_site` rather than `home_field`.** Both choices are corrections
# to collinearity that a first version got wrong in two different ways:
#
#   1. Folding the rating offset into the gap AND supplying a home indicator
#      makes the two exactly collinear on every non-neutral game. Ridge split
#      the weight arbitrarily and produced `elo_diff +3.383` against
#      `home_field -0.973` — a home advantage spread across two coefficients
#      of opposite sign, uninterpretable and unstable from fit to fit.
#
#   2. Fixing that and keeping a `home_field` indicator moved the problem
#      rather than solving it. Only ~50 games in 6,000 are at neutral sites,
#      so `home_field` is 1 almost everywhere and is therefore collinear with
#      the INTERCEPT. It fitted to +0.625 against an intercept of +1.973,
#      which implies a neutral-site game still carries +1.97 of home
#      advantage — nonsense, and nonsense that no summary statistic flags.
#
# Coded as `neutral_site` (1 when neutral, 0 otherwise) the degeneracy is
# gone and both parameters are readable: **the intercept IS the home
# advantage in points**, and the `neutral_site` coefficient is how much of it
# a neutral venue removes.
#
# **`turnover_diff` and `yards_diff` were removed rather than fed zeros.**
# They fitted to a coefficient of exactly 0.000 because the box-score columns
# they read are NULL for the entire corpus — the scoreboard endpoint does not
# carry team statistics and the per-game summary backfill is a separate pass.
# A feature that is constant is not a weak feature, it is an absent one, and
# leaving it in the vector means publishing a model whose width is a lie. The
# sibling NBA project shipped two months with every team-stat column NULL and
# nothing failed; the only reason this was caught here in minutes is that the
# fitted coefficient was a suspiciously exact zero.
#
# They come back when `backfill_boxscores` has run, and not before.
FEATURE_NAMES: Tuple[str, ...] = (
    "elo_diff",              # (home - away) rating points / 100, NO hfa
    "neutral_site",          # 1 at a neutral venue; intercept carries HFA
    "rest_diff",             # (home rest days - away rest days) / 7
    "off_bye_home",          # home team coming off its bye week
    "off_bye_away",          # away team coming off its bye week
    "form_margin_diff",      # rolling mean point differential, home - away
    "form_total_diff",       # rolling mean points scored, home + away, centred
    "division_game",         # 1 when the two share a division
    "week_progress",         # week / weeks_in_season: how settled the season is
)


@dataclass
class TeamState:
    """Rolling, strictly-backward-looking state for one franchise."""

    margins: Deque[float] = field(default_factory=lambda: deque(maxlen=WINDOW))
    points_for: Deque[float] = field(default_factory=lambda: deque(maxlen=WINDOW))
    turnovers: Deque[float] = field(default_factory=lambda: deque(maxlen=WINDOW))
    yards: Deque[float] = field(default_factory=lambda: deque(maxlen=WINDOW))
    last_played: Optional[datetime] = None

    def mean_margin(self) -> float:
        return float(np.mean(self.margins)) if self.margins else 0.0

    def mean_points(self) -> float:
        return float(np.mean(self.points_for)) if self.points_for else 22.0

    def mean_turnovers(self) -> float:
        return float(np.mean(self.turnovers)) if self.turnovers else 0.0

    def mean_yards(self) -> float:
        return float(np.mean(self.yards)) if self.yards else 330.0


class FeatureBuilder:
    """Builds the design matrix, and serves the identical vector live."""

    def __init__(self, *, home_advantage_elo: float = 48.0):
        self.home_advantage_elo = home_advantage_elo
        self.states: Dict[int, TeamState] = defaultdict(TeamState)
        self.divisions: Dict[int, Optional[str]] = {}
        self._previous_date = ""

    # ------------------------------------------------------------- setup

    def set_divisions(self, divisions: Dict[int, Optional[str]]) -> None:
        """Register each team's division, for the `division_game` feature."""
        self.divisions = dict(divisions)

    # ---------------------------------------------------------- features

    def _rest_days(self, team_id: int, kickoff: datetime) -> Tuple[float, bool]:
        """(rest days, is this team coming off a bye).

        Returns the neutral value and False across a season boundary — see
        the note on `OFFSEASON_GAP` for the bug that came from conflating a
        summer with a bye week.
        """
        state = self.states[team_id]
        if state.last_played is None:
            return REST_DEFAULT, False
        delta = (kickoff - state.last_played).total_seconds() / 86400.0
        if delta > OFFSEASON_GAP:
            return REST_DEFAULT, False
        return float(min(max(delta, REST_MIN), REST_MAX)), delta >= BYE_THRESHOLD

    def vector_for(
        self,
        *,
        home_team_id: int,
        away_team_id: int,
        home_elo: float,
        away_elo: float,
        kickoff: datetime,
        week: int,
        weeks_in_season: int,
        neutral_site: bool = False,
    ) -> np.ndarray:
        """The served feature vector.

        **This is the serving path, and it populates exactly what `build`
        populates.** Nothing may be added here that the live path cannot
        compute, and nothing may be added to `build` that is not mirrored
        here. `dead_feature_blocks` checks that claim numerically.
        """
        home = self.states[home_team_id]
        away = self.states[away_team_id]

        # No home-advantage offset here — `home_field` carries it. See the
        # note on FEATURE_NAMES for what folding it in here cost.
        elo_diff = (home_elo - away_elo) / 100.0

        # A bye is the only way to get 12+ days between games INSIDE a
        # season. The rest_diff feature is roughly linear; the off-bye flags
        # let the model price the discontinuity separately, because a bye is
        # extra preparation as well as extra recovery.
        home_rest, off_bye_home = self._rest_days(home_team_id, kickoff)
        away_rest, off_bye_away = self._rest_days(away_team_id, kickoff)

        home_div = self.divisions.get(home_team_id)
        away_div = self.divisions.get(away_team_id)
        division_game = (
            1.0 if home_div is not None and home_div == away_div else 0.0
        )

        return np.array(
            [
                elo_diff,
                1.0 if neutral_site else 0.0,
                (home_rest - away_rest) / 7.0,
                1.0 if off_bye_home else 0.0,
                1.0 if off_bye_away else 0.0,
                (home.mean_margin() - away.mean_margin()) / 10.0,
                (home.mean_points() + away.mean_points() - 44.5) / 10.0,
                division_game,
                float(week) / float(max(weeks_in_season, 1)),
            ],
            dtype=float,
        )

    # ---------------------------------------------------------- training

    def observe(self, row: Any) -> None:
        """Fold a played game into rolling state. Called AFTER emitting it."""
        home_id = int(row["home_team_id"])
        away_id = int(row["away_team_id"])
        home_score = float(row["home_score"])
        away_score = float(row["away_score"])
        kickoff = _parse(row["date_utc"])

        home, away = self.states[home_id], self.states[away_id]
        home.margins.append(home_score - away_score)
        away.margins.append(away_score - home_score)
        home.points_for.append(home_score)
        away.points_for.append(away_score)

        # Box-score columns are absent for older seasons and for any game
        # whose summary has not been fetched. Absent stays absent — the
        # rolling mean simply does not move — rather than being imputed.
        h_to, a_to = row["home_turnovers"], row["away_turnovers"]
        if h_to is not None and a_to is not None:
            home.turnovers.append(float(a_to) - float(h_to))
            away.turnovers.append(float(h_to) - float(a_to))
        h_yd, a_yd = row["home_total_yards"], row["away_total_yards"]
        if h_yd is not None and a_yd is not None:
            home.yards.append(float(h_yd))
            away.yards.append(float(a_yd))

        home.last_played = kickoff
        away.last_played = kickoff

    def observe_scheduled(self, home_team_id: int, away_team_id: int, kickoff: datetime) -> None:
        """Advance the schedule clock past an UNPLAYED fixture.

        The serving counterpart to `observe`. It moves `last_played` and
        touches nothing else — there is no result to fold in, and inventing
        one would be exactly the fabrication this project forbids.

        Without it, every fixture in a future season is priced against the
        team's last REAL game, so all 272 of them see the same offseason gap
        and `rest_diff` is identically zero. That is not a small loss: rest is
        the largest scheduling signal in football, and the whole point of
        carrying it is that a Thursday game and a post-bye game differ. The
        clock has to run forward through the schedule for week 5's rest to be
        measured from week 4.
        """
        for team_id in (home_team_id, away_team_id):
            self.states[team_id].last_played = kickoff

    def build(
        self,
        rated_games: Sequence[Any],
        rows: Sequence[Any],
        *,
        weeks_in_season_for: Optional[Dict[int, int]] = None,
        warmup_seasons: int = 2,
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray, List[Dict[str, Any]]]:
        """Walk the corpus and emit (X, margins, totals, metadata).

        `rated_games` and `rows` must be the SAME games in the SAME order —
        the output of `EloRatingSystem.run` over `Warehouse.iter_games`.
        Metadata is emitted alongside each row rather than left to be
        recovered by index, so there is no index to get wrong.

        The first `warmup_seasons` are walked but not emitted: rolling state
        and Elo both start empty, and a model fitted on games where every
        rolling feature is its default value learns that the defaults predict
        the mean.
        """
        if len(rated_games) != len(rows):
            raise ValueError(
                f"rated={len(rated_games)} rows={len(rows)} — these must be "
                "the same games in the same order"
            )

        weeks_map = weeks_in_season_for or {}
        seasons = sorted({int(r["season"]) for r in rows})
        emit_from = seasons[min(warmup_seasons, len(seasons) - 1)] if seasons else 0

        features: List[np.ndarray] = []
        margins: List[float] = []
        totals: List[float] = []
        meta: List[Dict[str, Any]] = []
        previous_date = ""

        for rated, row in zip(rated_games, rows):
            if row["date_utc"] < previous_date:
                raise ValueError(
                    f"games are out of order: {row['date_utc']} follows "
                    f"{previous_date}. A feature built on an unordered stream "
                    "reads the future."
                )
            previous_date = row["date_utc"]

            if rated.game_id != row["game_id"]:
                raise ValueError(
                    f"rated game {rated.game_id} does not match row "
                    f"{row['game_id']} — the two sequences have drifted"
                )

            season = int(row["season"])
            week = int(row["week"])
            vector = self.vector_for(
                home_team_id=int(row["home_team_id"]),
                away_team_id=int(row["away_team_id"]),
                home_elo=rated.home_elo,
                away_elo=rated.away_elo,
                kickoff=_parse(row["date_utc"]),
                week=week,
                weeks_in_season=weeks_map.get(season, 18),
                neutral_site=bool(row["neutral_site"]),
            )

            if season >= emit_from:
                features.append(vector)
                margins.append(float(row["home_score"]) - float(row["away_score"]))
                totals.append(float(row["home_score"]) + float(row["away_score"]))
                meta.append(
                    {
                        "game_id": row["game_id"],
                        "date_utc": row["date_utc"],
                        "season": season,
                        "week": week,
                        "home_team_id": int(row["home_team_id"]),
                        "away_team_id": int(row["away_team_id"]),
                        "home_score": int(row["home_score"]),
                        "away_score": int(row["away_score"]),
                        "ml_home": row["ml_home"],
                        "ml_away": row["ml_away"],
                        "spread_home": row["spread_home"],
                        "total_points": row["total_points"],
                    }
                )

            self.observe(row)

        if not features:
            raise ValueError("no games survived the warm-up window")
        return (
            np.vstack(features),
            np.asarray(margins, dtype=float),
            np.asarray(totals, dtype=float),
            meta,
        )


def dead_feature_blocks(
    train: np.ndarray,
    served: np.ndarray,
    names: Sequence[str] = FEATURE_NAMES,
    *,
    tolerance: float = 0.05,
) -> List[str]:
    """Features whose served values carry no variance the training set had.

    **Compares VARIANCE, not names.** The sibling project's train/serve skew
    bug had perfectly matching feature names and completely different values,
    so a name check would have passed it. A feature that varies across the
    training corpus and is constant at serving time is a feature the serving
    path cannot populate, whatever it is called — and it will silently fall
    back to the intercept.

    Returns the names of the offending features, so a publisher can refuse to
    write rather than publish a forecast built on eleven-elevenths of a model.
    """
    train = np.atleast_2d(np.asarray(train, dtype=float))
    served = np.atleast_2d(np.asarray(served, dtype=float))
    if train.shape[1] != served.shape[1]:
        raise ValueError(
            f"training has {train.shape[1]} features, serving has "
            f"{served.shape[1]} — these are not the same model"
        )
    if len(served) < 2:
        return []

    dead: List[str] = []
    for index in range(train.shape[1]):
        train_sd = float(train[:, index].std())
        served_sd = float(served[:, index].std())
        if train_sd > tolerance and served_sd <= tolerance:
            dead.append(
                names[index] if index < len(names) else f"feature[{index}]"
            )
    return dead


def constant_features(
    train: np.ndarray,
    names: Sequence[str] = FEATURE_NAMES,
    *,
    tolerance: float = 1e-6,
) -> List[str]:
    """Features that do not vary across the TRAINING corpus.

    The companion to `dead_feature_blocks`, which compares training against
    serving and therefore cannot see a feature that is dead in both. That is
    not a hypothetical gap: `turnover_diff` and `yards_diff` were dead
    everywhere, because the box-score columns behind them are NULL for the
    whole corpus, and they fitted to a coefficient of exactly zero while
    every consistency check passed.

    A constant column costs a degree of freedom, contributes nothing, and —
    the part that matters — makes the model look wider than it is to anyone
    reading the feature list.
    """
    train = np.atleast_2d(np.asarray(train, dtype=float))
    return [
        names[i] if i < len(names) else f"feature[{i}]"
        for i in range(train.shape[1])
        if float(train[:, i].std()) <= tolerance
    ]


def _parse(raw: str) -> datetime:
    return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
