"""Elo ratings for NFL franchises.

The structural baseline of this project, and the yardstick every later model
must beat. It is the analogue of the NBA project's Elo floor and the soccer
project's Elo/Dixon-Coles floor: cheap, transparent, hard to beat by much,
and **never deleted**.

`backend/scripts/tune_elo.py` sweeps every constant below and writes
`backend/data/diagnostics/elo_sweep.json`. Nothing here is chosen.

Four football-specific choices
------------------------------

1. **Margin of victory feeds the update, with diminishing returns.** A
   28-point win is more evidence than a 1-point win, but not 28 times more,
   and garbage-time scoring inflates blowouts. The multiplier is
   `ln(|mov| + 1) * base / (base + autocorrelation * elo_diff_winner)`.

   **The functional form differs from the NBA project's** — logarithmic here,
   a power law there — and that is not a stylistic preference. Football
   margins are bounded by roughly 60 and cluster tightly under 10; basketball
   margins run to 50 routinely. A log flattens hard exactly where football
   needs it to, and it is the form the public NFL Elo literature converged on
   for the same reason.

   The denominator is the autocorrelation correction: without it a strong
   team beating a weak one by 20 gains rating for meeting expectations, and
   favourites drift upward forever.

2. **Ratings regress toward the mean between seasons, hard.** The NFL has a
   draft in reverse order of finish, a hard salary cap and unguaranteed
   contracts — the most aggressively levelling institutions in major
   professional sport. This is the same direction as the NBA project's
   finding and the OPPOSITE of the soccer project's, which tested
   season-boundary regression and rejected it at every level. European
   football has no draft and no cap, so its clubs genuinely do stay good.

   **Do not port the NBA's carryover value even though the direction agrees.**
   A 17-game season carries far less information than an 82-game one, so the
   end-of-season rating is a noisier estimate and should be trusted less.
   The sweep settles it.

3. **A tie is half a win, and it is a real outcome.** `actual = 0.5`. The NBA
   sibling has no branch for this and is right not to. Here, omitting it
   would make a tie score as a loss for the home side and a win for the
   visitor, which is not a rounding error — it is a wrong sign on both teams.

4. **Home advantage is a rating offset and it has been shrinking.** Fitted
   per era rather than frozen, because the league-wide home win rate has
   fallen and a fixed constant would quietly mis-price every modern game.

The rating scale
----------------

`POINTS_PER_ELO` converts a rating gap into a point spread. It is the single
constant most likely to be misread across the sibling projects: 28 rating
points is worth one NBA point and roughly 25 is worth one NFL point, but an
NFL point is a far larger share of a game. A 100-point rating edge is about
3.5 points of NBA margin and about 4 points of NFL margin — on games whose
margins have similar standard deviations but completely different totals.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

# The rating every franchise starts from, and the mean seasons regress
# toward. 1500 is conventional; nothing downstream depends on the level,
# only on differences.
BASE_RATING = 1500.0

# Rating points per expected point of margin. Measured, not assumed: the
# margin model's `elo_diff` coefficient is +3.383 points per 100 rating
# points over the 2002-2025 corpus, so 100 / 3.383 = 29.6.
#
# The first version of this file carried 25.0, taken from the public NFL Elo
# literature. That is a defensible number for a differently-tuned rating and
# it is wrong for THIS one — the conversion depends on the k-factor and MOV
# multiplier that produced the ratings, so it cannot be borrowed across
# implementations. `margin_model` refits it; this is the cold-start value and
# the one the Elo-only baseline uses.
POINTS_PER_ELO = 29.6

# Swept by `tune_elo.py`. See `backend/data/diagnostics/elo_sweep.json` for
# the full grid; the docstring in that script records the decisive columns.
DEFAULTS = {
    "k_factor": 20.0,
    "carryover": 0.65,
    "home_advantage": 48.0,
    "mov_base": 2.2,
    "autocorrelation": 0.001,
}

# Home advantage is NOT stable in this sport. Measured per era by
# `tune_elo.py --home-advantage-by-era`; filled in from the corpus rather
# than asserted here, and read by the Elo-only baseline only — the margin
# model refits and picks up the drift through its intercept.
HOME_ADVANTAGE_BY_ERA: Dict[Tuple[int, int], float] = {}


@dataclass
class EloConfig:
    k_factor: float = DEFAULTS["k_factor"]
    carryover: float = DEFAULTS["carryover"]
    home_advantage: float = DEFAULTS["home_advantage"]
    mov_base: float = DEFAULTS["mov_base"]
    autocorrelation: float = DEFAULTS["autocorrelation"]
    base_rating: float = BASE_RATING

    def as_dict(self) -> Dict[str, float]:
        return {
            "k_factor": self.k_factor,
            "carryover": self.carryover,
            "home_advantage": self.home_advantage,
            "mov_base": self.mov_base,
            "autocorrelation": self.autocorrelation,
            "base_rating": self.base_rating,
        }


@dataclass
class RatedGame:
    """One game's ratings, captured BEFORE it was played.

    `home_elo` / `away_elo` are the pre-game values, which is what a feature
    may use. The post-game values are written back into the rating table and
    are only readable by a later game — see `Warehouse.latest_elo`, which
    takes ratings strictly earlier than the date asked for.
    """

    game_id: str
    date_utc: str
    season: int
    week: int
    home_team_id: int
    away_team_id: int
    home_elo: float
    away_elo: float
    home_elo_post: float
    away_elo_post: float
    expected_home: float
    home_won: bool
    is_tie: bool
    margin: int


class EloRatingSystem:
    """Rolling Elo over a chronologically ordered stream of games."""

    def __init__(self, config: Optional[EloConfig] = None):
        self.config = config or EloConfig()
        self.ratings: Dict[int, float] = {}
        self._last_season: Optional[int] = None
        self.history: List[RatedGame] = []

    # -------------------------------------------------------------- read

    def get(self, team_id: int) -> float:
        return self.ratings.get(team_id, self.config.base_rating)

    def set(self, team_id: int, rating: float) -> None:
        self.ratings[team_id] = float(rating)

    def expected_score(
        self, home_elo: float, away_elo: float, *, neutral: bool = False
    ) -> float:
        """Expected home score in [0, 1] from the rating difference alone.

        This is the Elo expectation, which is a WIN-OR-HALF expectation
        rather than a win probability: a tie contributes 0.5 to the realised
        score, so the number this returns is
        `P(home wins) + 0.5 * P(tie)`.

        The distinction is small (ties are well under 1% of games) and it is
        stated because the Elo-only baseline is scored against the market as
        if it were a win probability. `benchmark_market` conditions it through
        `market.conditional_from_three` rather than using it raw.
        """
        edge = 0.0 if neutral else self.config.home_advantage
        diff = (home_elo + edge) - away_elo
        return 1.0 / (1.0 + 10.0 ** (-diff / 400.0))

    def expected_margin(
        self, home_elo: float, away_elo: float, *, neutral: bool = False
    ) -> float:
        edge = 0.0 if neutral else self.config.home_advantage
        return ((home_elo + edge) - away_elo) / POINTS_PER_ELO

    # ------------------------------------------------------------ update

    def regress_to_season(self, season: int) -> bool:
        """Apply the offseason regression for a season not yet played.

        **A forecaster must call this and a backtest must not.** The rolling
        update applies carryover lazily, when the first game of a new season
        arrives — which is correct while walking a corpus, and wrong the
        moment you stop walking and start projecting. `forecast_season` fits
        on every game ever played and then asks for ratings for a season
        whose first game does not exist yet, so without this the projection
        runs on END-OF-LAST-SEASON ratings and skips the regression the sweep
        measures as the single most valuable Elo setting.

        The NBA project documents this costing it a 43% title probability
        against a market that priced no favourite above the mid-20s. The same
        failure here is worse, not better: a 17-game season produces more
        extreme end-of-season ratings than an 82-game one, so there is more
        to regress and the unregressed projection is further out.

        Returns True when it did something, so a caller can log it.
        """
        if self._last_season is not None and season <= self._last_season:
            return False
        carry = self.config.carryover
        base = self.config.base_rating
        for team_id, rating in list(self.ratings.items()):
            self.ratings[team_id] = carry * rating + (1.0 - carry) * base
        self._last_season = season
        return True

    def _regress_for_new_season(self, season: int) -> None:
        """Pull every rating toward the mean at a season boundary.

        Applied to EVERY franchise, including one that did not play last
        season. A team that misses the boundary keeps a stale rating and then
        competes against regressed ones, which is the same bug as forgetting
        to age a cohort.
        """
        if self._last_season is None or season == self._last_season:
            self._last_season = season
            return
        carry = self.config.carryover
        base = self.config.base_rating
        for team_id, rating in list(self.ratings.items()):
            self.ratings[team_id] = carry * rating + (1.0 - carry) * base
        self._last_season = season

    def _mov_multiplier(self, margin: int, elo_diff_winner: float) -> float:
        """Diminishing-returns weight on the margin of victory.

        `elo_diff_winner` is the winner's pre-game rating edge (including
        home advantage). The denominator grows with it, so a favourite
        winning big gains less than an underdog winning big — the
        autocorrelation correction that stops ratings running away.

        A tie has |margin| = 0, so `ln(1) = 0` would zero the update
        entirely and a tie would carry no information at all. It carries
        real information — two teams were level — so the margin term floors
        at a one-point game.
        """
        cfg = self.config
        numerator = math.log(max(abs(margin), 1) + 1.0)
        denominator = cfg.mov_base + cfg.autocorrelation * elo_diff_winner
        if denominator <= 0:
            denominator = 1e-6
        return numerator * cfg.mov_base / denominator

    def update(
        self,
        *,
        game_id: str,
        date_utc: str,
        season: int,
        week: int,
        home_team_id: int,
        away_team_id: int,
        home_score: int,
        away_score: int,
        neutral: bool = False,
    ) -> RatedGame:
        """Rate one game and fold the result back in.

        Returns the PRE-game ratings alongside the post-game ones so a caller
        building features never has to reconstruct them, and can never
        accidentally read the post-game value for the game it is predicting.
        """
        self._regress_for_new_season(season)

        home_elo = self.get(home_team_id)
        away_elo = self.get(away_team_id)
        expected_home = self.expected_score(home_elo, away_elo, neutral=neutral)

        margin = int(home_score) - int(away_score)
        is_tie = margin == 0
        home_won = margin > 0
        # A tie is half a win for each side. Without this branch it scores as
        # a home loss and an away win.
        actual = 0.5 if is_tie else (1.0 if home_won else 0.0)

        edge = 0.0 if neutral else self.config.home_advantage
        if is_tie:
            # Nobody won, so there is no winner's edge to correct against.
            # The absolute gap is the right scale-free stand-in.
            elo_diff_winner = abs((home_elo + edge) - away_elo)
        elif home_won:
            elo_diff_winner = (home_elo + edge) - away_elo
        else:
            elo_diff_winner = away_elo - (home_elo + edge)

        multiplier = self._mov_multiplier(margin, elo_diff_winner)
        delta = self.config.k_factor * multiplier * (actual - expected_home)

        home_post = home_elo + delta
        away_post = away_elo - delta
        self.ratings[home_team_id] = home_post
        self.ratings[away_team_id] = away_post

        rated = RatedGame(
            game_id=game_id,
            date_utc=date_utc,
            season=season,
            week=week,
            home_team_id=home_team_id,
            away_team_id=away_team_id,
            home_elo=home_elo,
            away_elo=away_elo,
            home_elo_post=home_post,
            away_elo_post=away_post,
            expected_home=expected_home,
            home_won=home_won,
            is_tie=is_tie,
            margin=margin,
        )
        self.history.append(rated)
        return rated

    # ------------------------------------------------------------- bulk

    def run(self, games: Iterable) -> List[RatedGame]:
        """Rate a chronologically ordered iterable of warehouse game rows.

        **Order is the contract.** Rating a stream out of order silently
        produces ratings that saw the future, and nothing about the output
        looks wrong. Callers use `Warehouse.iter_games`, which sorts on
        `(date_utc, game_id)`.
        """
        out: List[RatedGame] = []
        previous_date = ""
        for row in games:
            date_utc = row["date_utc"]
            if date_utc < previous_date:
                raise ValueError(
                    f"games are out of order: {date_utc} follows {previous_date}. "
                    "Elo over an unordered stream reads the future."
                )
            previous_date = date_utc
            out.append(
                self.update(
                    game_id=row["game_id"],
                    date_utc=date_utc,
                    season=int(row["season"]),
                    week=int(row["week"]),
                    home_team_id=int(row["home_team_id"]),
                    away_team_id=int(row["away_team_id"]),
                    home_score=int(row["home_score"]),
                    away_score=int(row["away_score"]),
                    neutral=bool(row["neutral_site"]),
                )
            )
        return out

    def rankings(self, top_n: Optional[int] = None) -> List[Tuple[int, float]]:
        ordered = sorted(self.ratings.items(), key=lambda kv: kv[1], reverse=True)
        return ordered[:top_n] if top_n else ordered

    def snapshot(self) -> Dict[int, float]:
        return dict(self.ratings)


def fit_home_advantage(games: Sequence, *, minimum: int = 200) -> Optional[float]:
    """Home advantage in RATING points, from the observed home result rate.

    Inverts the logistic: a home score rate of p in a corpus of otherwise
    balanced matchups implies a rating edge of `400 * log10(p / (1 - p))`.

    Ties count as half, matching `EloRatingSystem.update`. Counting them as
    losses would understate home advantage by roughly the tie rate.

    Returns None below `minimum` games rather than a number from a sample
    that cannot support one.
    """
    played = [g for g in games if not g["neutral_site"]]
    if len(played) < minimum:
        return None
    score = 0.0
    for game in played:
        if game["home_score"] > game["away_score"]:
            score += 1.0
        elif game["home_score"] == game["away_score"]:
            score += 0.5
    rate = score / len(played)
    if not 0.0 < rate < 1.0:
        return None
    return 400.0 * math.log10(rate / (1.0 - rate))


_system: Optional[EloRatingSystem] = None


def get_elo_system(config: Optional[EloConfig] = None) -> EloRatingSystem:
    global _system
    if _system is None or config is not None:
        _system = EloRatingSystem(config)
    return _system
