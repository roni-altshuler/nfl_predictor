"""Market mathematics: de-vigging, scoring rules, value and staking.

Ported from the sibling NBA project, which reduced the soccer project's three
outcomes to two. **Football lands between them, and pretending otherwise is
the mistake this module exists to prevent.**

The tie, and why it is not a rounding error
-------------------------------------------

An NFL regular-season game can end level. Overtime is ten minutes and does
not guarantee a winner, so the outcome space is genuinely {home, tie, away} —
unlike the NBA, whose sibling module is built on a measured zero ties in
27,690 games and is correct to be.

Ties are rare. They are not zero, and the two facts pull in opposite
directions:

* Rare enough that a *win probability* which ignores them is barely wrong.
* Structural enough that a *scoring harness* which ignores them is
  meaningfully wrong, because it has to decide what a tie scores against a
  forecast of 1/0, and any silent choice is a bias.

**The moneyline market does not price the tie at all — it VOIDS on one.** A
tie is a push: stakes returned, no winner. So a de-vigged two-way NFL
moneyline is not P(home wins); it is P(home wins | the game is decided).
Reading it as the former and comparing it against a model that does allocate
tie mass compares two different quantities and hands the model a spurious
edge on every game.

This module therefore keeps the two representations explicitly separate:

* `Probabilities` is the two-way CONDITIONAL pair, summing to 1, which is
  what the market speaks and what every scoring function takes.
* `conditional_from_three` is the only sanctioned way to get there from a
  model's (home, tie, away), and it is what `benchmark_market` calls.

Scoring convention
------------------

`brier_score` is the BINARY Brier on the home-win indicator, over DECIDED
games only. Ties are excluded from the paired comparison and **counted, not
quietly dropped** — `score_forecasts` returns `ties_excluded` and every
caller that reports a benchmark reports that number beside it.

Excluding them is the lesser of the two available evils, and the reasoning is
worth stating because it is not obvious:

* Scoring a tie as y = 0.5 keeps the games but invents an outcome neither
  forecaster was asked about, and it flatters whichever forecaster happened
  to be nearer .5 for reasons unrelated to skill.
* Excluding them conditions on the outcome, which is a real if small
  selection effect.

The second is smaller, it matches what the market itself is pricing, and —
decisively — it is the comparison that is *paired*: both forecasters are
scored on exactly the same games. `score_forecasts` also reports the
all-games figure under `brier_ties_as_half` so the choice can be checked
rather than trusted.

The bar is high, as it was for basketball
-----------------------------------------

A binary market is well calibrated, so a small absolute gap is a large
relative one. **Never compare a Brier from this project against one from the
soccer project** (multiclass over three outcomes) or against one from the NBA
project (binary, but a different base rate and a different sport). Different
outcome spaces, different scales, different meanings.

Conventions
-----------
* American odds in, decimal odds derived. American is what ESPN publishes and
  converting on the way in would bake a convention into stored data.
* Shin is the default de-vig, as in the sibling project. The two methods
  agree near even money and diverge as the favourite shortens; NFL prices
  reach -1000 in December, so the method is recorded with every benchmark.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

# The two-way CONDITIONAL pair: P(home | decided), P(away | decided).
Probabilities = Tuple[float, float]

# A book's overround on a two-way NFL moneyline sits around 4-5%. Anything
# outside this band is a parsing error, not a generous book: a booksum below
# 1 is an arbitrage that does not exist at scale, and above 1.30 means the
# two legs came from different games.
MIN_BOOKSUM = 0.90
MAX_BOOKSUM = 1.30


class MarketError(ValueError):
    """Base class for market input errors."""


class InvalidOddsError(MarketError):
    """Odds that cannot describe a real price."""


class ProbabilityError(MarketError):
    """A probability vector that is not one."""


# ------------------------------------------------------------------ odds


def american_to_decimal(american: float) -> float:
    """American moneyline → decimal odds.

    -218 → 1.4587 (risk 218 to win 100); +180 → 2.80.
    Zero is refused: it is not a price, and it is what an empty field
    coerces to.
    """
    value = float(american)
    if value == 0 or not math.isfinite(value):
        raise InvalidOddsError(f"{american!r} is not a moneyline")
    if value > 0:
        return 1.0 + value / 100.0
    return 1.0 + 100.0 / abs(value)


def decimal_to_american(decimal: float) -> float:
    value = float(decimal)
    if value <= 1.0 or not math.isfinite(value):
        raise InvalidOddsError(f"{decimal!r} is not decimal odds")
    if value >= 2.0:
        return (value - 1.0) * 100.0
    return -100.0 / (value - 1.0)


def has_complete_odds(ml_home: object, ml_away: object) -> bool:
    """True when BOTH legs are present.

    One leg is not a market. De-vigging needs the booksum, and a lone
    favourite price silently read as a probability carries the full vig.
    """
    for value in (ml_home, ml_away):
        if value is None:
            return False
        try:
            if float(value) == 0:  # type: ignore[arg-type]
                return False
        except (TypeError, ValueError):
            return False
    return True


# ------------------------------------------------------------ de-vigging


def implied_probabilities(ml_home: float, ml_away: float) -> Probabilities:
    """Raw implied probabilities, vig included. They sum to > 1."""
    dh = american_to_decimal(ml_home)
    da = american_to_decimal(ml_away)
    return 1.0 / dh, 1.0 / da


def booksum(ml_home: float, ml_away: float) -> float:
    raw_home, raw_away = implied_probabilities(ml_home, ml_away)
    return raw_home + raw_away


def overround(ml_home: float, ml_away: float) -> float:
    return booksum(ml_home, ml_away) - 1.0


def devig_proportional(ml_home: float, ml_away: float) -> Probabilities:
    """Normalise the two raw probabilities to sum to 1."""
    raw_home, raw_away = implied_probabilities(ml_home, ml_away)
    total = raw_home + raw_away
    if not MIN_BOOKSUM <= total <= MAX_BOOKSUM:
        raise InvalidOddsError(
            f"booksum {total:.4f} outside [{MIN_BOOKSUM}, {MAX_BOOKSUM}] — "
            "these two legs are probably not the same game"
        )
    return raw_home / total, raw_away / total


def devig_shin(ml_home: float, ml_away: float) -> Probabilities:
    """Shin's method: remove the vig attributable to insider trading.

    For two outcomes Shin has a closed form, so there is no root-finding and
    no convergence to babysit. `z` is the estimated proportion of insider
    money; at z = 0 this reduces exactly to proportional de-vigging.
    """
    raw_home, raw_away = implied_probabilities(ml_home, ml_away)
    total = raw_home + raw_away
    if not MIN_BOOKSUM <= total <= MAX_BOOKSUM:
        raise InvalidOddsError(f"booksum {total:.4f} outside sane range")
    if total <= 1.0:
        return raw_home / total, raw_away / total

    pi_home = raw_home / total
    pi_away = raw_away / total
    if pi_home <= 0 or pi_away <= 0:
        return pi_home, pi_away

    z = _shin_z(raw_home, raw_away, total)
    if z <= 0:
        return pi_home, pi_away

    out = []
    for raw in (raw_home, raw_away):
        inner = z * z + 4.0 * (1.0 - z) * raw * raw / total
        out.append((math.sqrt(max(inner, 0.0)) - z) / (2.0 * (1.0 - z)))
    scale = out[0] + out[1]
    return out[0] / scale, out[1] / scale


def _shin_z(raw_home: float, raw_away: float, total: float) -> float:
    """Estimated insider proportion, bisected on the normalisation residual.

    Bisection rather than a closed form. The two-outcome case does admit an
    algebraic solution, but it is an ugly one that is easy to write down
    subtly wrong and impossible to eyeball afterwards — and a de-vig that is
    quietly a few points off does not fail, it just moves the benchmark this
    whole project is measured against. Eighty iterations on a monotone
    residual costs nothing and is obviously correct.
    """
    if total <= 1.0:
        return 0.0

    def residual(z: float) -> float:
        if z >= 1.0:
            return float("inf")
        acc = 0.0
        for raw in (raw_home, raw_away):
            acc += (
                math.sqrt(z * z + 4.0 * (1.0 - z) * raw * raw / total) - z
            ) / (2.0 * (1.0 - z))
        return acc - 1.0

    lo, hi = 0.0, 0.9
    if residual(lo) * residual(hi) > 0:
        return 0.0
    for _ in range(80):
        mid = (lo + hi) / 2.0
        if residual(lo) * residual(mid) <= 0:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2.0


def spread_to_probability(spread_home: float, sigma: float = 13.2) -> float:
    """Point spread → P(home wins | decided), through the margin distribution.

    `spread_home` is negative when the home side is favoured, so the expected
    home margin is `-spread_home`. `sigma` is the measured sd of NFL margins;
    see `margin_model.MARGIN_SD`.

    **This matters far more for football than it did for basketball.** ESPN's
    moneyline coverage on older NFL seasons is patchy while the spread is
    almost always present, so for a large part of the corpus the spread is
    the only market signal there is. A benchmark that required a moneyline
    would silently discard the majority of pre-2014 games.

    It is an approximation in a way the moneyline is not: it reads a
    continuous normal over a margin distribution that is emphatically not
    smooth (see `margin_model` on key numbers), so it is used to RECOVER a
    market probability where none was published, never to replace one that
    was. `benchmark_market` records which of the two produced each row.
    """
    return _normal_cdf(-float(spread_home) / sigma)


def _normal_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def devig(
    ml_home: float, ml_away: float, *, method: str = "shin"
) -> Probabilities:
    """De-vig a two-way moneyline. `method` is recorded by every caller."""
    if method == "shin":
        return devig_shin(ml_home, ml_away)
    if method == "proportional":
        return devig_proportional(ml_home, ml_away)
    raise ValueError(f"unknown de-vig method {method!r}")


# --------------------------------------------------- three → two outcomes


def conditional_from_three(
    p_home: float, p_tie: float, p_away: float
) -> Probabilities:
    """(home, tie, away) → the two-way pair the market speaks.

    **This is the only sanctioned bridge between a model's output and a
    market comparison**, and it exists because the moneyline VOIDS on a tie
    rather than pricing it. Conditioning on "the game is decided" is what
    makes the model's number and the book's number the same quantity.

    Comparing an unconditional `p_home` against a de-vigged moneyline instead
    understates the model by exactly the tie mass on every single game — a
    small, one-directional bias that would look like the model being
    systematically shaded toward the underdog.
    """
    home = max(float(p_home), 0.0)
    away = max(float(p_away), 0.0)
    decided = home + away
    if decided <= 0:
        raise ProbabilityError("p_home + p_away is zero — nothing to condition on")
    return home / decided, away / decided


def validate_probabilities(p_home: float, p_away: float, *, tol: float = 1e-6) -> None:
    total = float(p_home) + float(p_away)
    if abs(total - 1.0) > tol:
        raise ProbabilityError(f"probabilities sum to {total:.6f}, not 1")


# ---------------------------------------------------------- scoring rules


def brier_score(p_home: float, home_won: bool) -> float:
    """Binary Brier on the home-win indicator. Lower is better, range [0, 1].

    NOT the multiclass Brier the soccer project reports, and not comparable
    to it or to the NBA project's. Callers pass DECIDED games only.
    """
    outcome = 1.0 if home_won else 0.0
    return (float(p_home) - outcome) ** 2


def log_loss(p_home: float, home_won: bool, *, eps: float = 1e-15) -> float:
    p = min(max(float(p_home), eps), 1.0 - eps)
    return -(math.log(p) if home_won else math.log(1.0 - p))


def expected_calibration_error(
    probabilities: Sequence[float], outcomes: Sequence[bool], *, bins: int = 10
) -> float:
    """ECE over equal-width bins on [0, 1].

    Reported beside every Brier because two forecasters can share a Brier
    and differ entirely in how honest their confidence is.
    """
    if len(probabilities) != len(outcomes):
        raise ValueError("probabilities and outcomes must align")
    if not probabilities:
        return 0.0
    total = len(probabilities)
    error = 0.0
    for index in range(bins):
        lo = index / bins
        hi = (index + 1) / bins
        picked = [
            (p, o)
            for p, o in zip(probabilities, outcomes)
            if (p >= lo and p < hi) or (index == bins - 1 and p == 1.0)
        ]
        if not picked:
            continue
        mean_p = sum(p for p, _ in picked) / len(picked)
        rate = sum(1.0 for _, o in picked if o) / len(picked)
        error += (len(picked) / total) * abs(mean_p - rate)
    return error


@dataclass
class ScoreCard:
    """A forecaster's record on one set of games."""

    n: int
    brier: float
    log_loss: float
    accuracy: float
    ece: float
    ties_excluded: int
    brier_ties_as_half: Optional[float] = None

    def as_dict(self) -> Dict:
        out = {
            "n": self.n,
            "brier": round(self.brier, 5),
            "log_loss": round(self.log_loss, 5),
            "accuracy": round(self.accuracy, 5),
            "ece": round(self.ece, 5),
            "ties_excluded": self.ties_excluded,
        }
        if self.brier_ties_as_half is not None:
            out["brier_ties_as_half"] = round(self.brier_ties_as_half, 5)
        return out


def score_forecasts(
    probabilities: Sequence[float],
    home_scores: Sequence[int],
    away_scores: Sequence[int],
) -> ScoreCard:
    """Score two-way conditional forecasts against real results.

    Ties are excluded from the headline figures and COUNTED, for the reasons
    in the module docstring. `brier_ties_as_half` scores the same forecasts
    over every game with a tie as y = 0.5, so the effect of the exclusion is
    visible rather than asserted.
    """
    if not (len(probabilities) == len(home_scores) == len(away_scores)):
        raise ValueError("inputs must align")

    decided_p: List[float] = []
    decided_y: List[bool] = []
    all_p: List[float] = []
    all_y: List[float] = []
    ties = 0

    for p, hs, as_ in zip(probabilities, home_scores, away_scores):
        if int(hs) == int(as_):
            ties += 1
            all_p.append(float(p))
            all_y.append(0.5)
            continue
        won = int(hs) > int(as_)
        decided_p.append(float(p))
        decided_y.append(won)
        all_p.append(float(p))
        all_y.append(1.0 if won else 0.0)

    n = len(decided_p)
    if n == 0:
        return ScoreCard(0, float("nan"), float("nan"), float("nan"), float("nan"), ties)

    brier = sum(brier_score(p, y) for p, y in zip(decided_p, decided_y)) / n
    ll = sum(log_loss(p, y) for p, y in zip(decided_p, decided_y)) / n
    acc = sum(1.0 for p, y in zip(decided_p, decided_y) if (p >= 0.5) == y) / n
    ece = expected_calibration_error(decided_p, decided_y)
    half = sum((p - y) ** 2 for p, y in zip(all_p, all_y)) / len(all_p)

    return ScoreCard(n, brier, ll, acc, ece, ties, half)


# ---------------------------------------------------------- value staking


def expected_value(probability: float, american_odds: float) -> float:
    """EV per unit staked at a price. Positive means the price is generous."""
    decimal = american_to_decimal(american_odds)
    return float(probability) * (decimal - 1.0) - (1.0 - float(probability))


def kelly_fraction(
    probability: float, american_odds: float, *, cap: float = 0.05
) -> float:
    """Kelly stake as a fraction of bankroll, capped.

    Capped because full Kelly on a probability this project estimates rather
    than knows is a bankroll-destroying bet size. The cap is a product
    decision and is displayed alongside the number.
    """
    decimal = american_to_decimal(american_odds)
    b = decimal - 1.0
    if b <= 0:
        return 0.0
    p = float(probability)
    fraction = (b * p - (1.0 - p)) / b
    return max(0.0, min(fraction, cap))


def no_vig_price(probability: float) -> float:
    """The fair American price for a probability."""
    p = min(max(float(probability), 1e-9), 1 - 1e-9)
    return decimal_to_american(1.0 / p)
