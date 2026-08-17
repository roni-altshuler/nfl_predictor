"""The margin/total model — this project's structural forecaster.

It occupies the position the margin/total normal holds in the sibling NBA
project and Dixon-Coles holds in the soccer one: the well-specified
statistical model that serves by default, that any machine-learned challenger
has to beat on a paired bootstrap before it is promoted, and that is never
deleted.

Why not Poisson, and why not a plain normal either
--------------------------------------------------

Dixon-Coles models two goal counts as correlated Poisson draws because soccer
scores are small integers where the Poisson shape is genuinely right. Neither
sibling shape survives contact with football.

The NBA project parameterises on **margin** and **total** and reads both off
a fitted normal, and for basketball that is a genuinely good fit. The same
two parameters are right here — the interesting quantities are the difference
and the sum, not the two scores — but **the normal is not**, and the way it
fails is invisible in every summary statistic anyone would think to check.

Measured on 6,223 regular-season games, 2002-2025:

    margin: mean +2.193, sd 14.641, skew +0.070, excess kurtosis +0.203
    total:  mean 44.53,  sd 14.03,  skew +0.319, excess kurtosis +0.161
    corr(margin, total) = +0.019

Those margin moments are what a textbook would print as "normal is an
excellent fit". Skewness of 0.07 is nothing. Excess kurtosis of 0.20 is
nothing. **And the distribution is nothing like a normal**, because football
scores are built out of 3s and 7s:

    |margin| = 3   14.82% of games      a normal expects  5.4%
    |margin| = 7    9.08%                                 5.2%
    |margin| = 5    3.57%                                 5.4%
    |margin| = 9    1.54%                                 4.9%

A three-point game is **nine times** more common than a nine-point game. No
moment up to fourth order can see this, because the lumpiness is periodic
rather than skewed or heavy-tailed: it moves mass between adjacent integers
while leaving the shape at scale untouched.

The model: a normal kernel modulated by a measured lattice weight
-----------------------------------------------------------------

    P(margin = k | mu, sigma)  ∝  w(k) * N(k; mu, sigma)

`N` carries the location and spread, which genuinely are normal and which
genuinely do move with team strength. `w(k)` carries the arithmetic of
football scoring, which does not move with team strength at all — a
three-point game is over-represented whether the game was a pick'em or a
blowout, because 3 is what a field goal is worth.

`w` is measured, not designed: it is the ratio of the empirical margin
frequency to what a fitted normal expects, shrunk toward 1 where counts are
thin so the tails do not chase noise. Its values are the whole argument:

    w(0) = 0.21   w(3) = 2.71   w(7) = 1.76   w(10) = 1.37   w(14) = 1.29
    w(5) = 0.73   w(9) = 0.46   w(11) = 0.60

**w(0) = 0.21 is the one to read twice.** A normal fitted to these margins
expects 168 ties in this corpus. There were 15. Ties are five times rarer
than the continuous shape implies, for the obvious reason that landing
exactly level is arithmetically awkward — and a model that took the normal at
its word would publish a 2.7% tie probability on every game instead of 0.24%.

What this buys, concretely
--------------------------

1. **A real tie probability**, from the sport's actual lattice. The NBA
   sibling correctly has no tie branch at all (0 ties in 27,690 games). Here
   `p_tie` is small, nonzero and measured.

2. **Honest pushes on the spread.** When the line is exactly -3, `P(home
   covers)`, `P(push)` and `P(home fails to cover)` are three different
   numbers and the push is worth 14.8% of the market. A continuous normal
   assigns the push zero mass by construction and silently redistributes it
   to the two sides — on the single most commonly traded number in the sport.
   `cover_probabilities` returns all three.

3. **Win probability that is unchanged.** P(margin > 0) integrates over half
   the lattice, so the lumpiness very nearly cancels and the normal was
   already fine for the moneyline. That is worth stating plainly: this
   machinery is not here to move the headline number, and
   `test_lattice_and_normal_agree_on_the_moneyline` pins that it does not.

The win probability and the margin distribution are reconciled by
construction — `p_home` IS the sum of the lattice above zero, not a second
number computed alongside it. `test_moneyline_is_the_lattice_sum` pins it.
"""

from __future__ import annotations

import json
import logging
import math
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

logger = logging.getLogger(__name__)

# Measured on the warehouse corpus; refitted by `fit()` and persisted with
# the artifact. Named constants so a caller that skips fitting still gets the
# league's real dispersion rather than a guess.
MARGIN_SD = 13.2      # residual sd, after features. Unconditional is 14.64.
TOTAL_SD = 13.6

# The lattice the margin distribution is evaluated on. Widest regular-season
# margin in the corpus is 59; +/-70 is comfortable headroom and the tails
# carry no meaningful mass.
LATTICE_LOW = -70
LATTICE_HIGH = 70

# Shrinkage for the key-number weights, as a gamma-Poisson prior with mean 1
# and strength `alpha` expressed in expected games.
#
# A margin of 47 appears twice in 6,223 games; without shrinkage its weight
# would be whatever those two games happened to do. Swept against the two
# things that actually matter — how far the tail weights wander, and whether
# the served tie probability reproduces the measured 0.241%:
#
#   alpha    w(0)    p_tie     tail sd
#      2     .100    .0030      .287
#      5     .116    .0034      .195
#      8     .131    .0039      .153      <- served
#     12     .150    .0045      .120
#     25     .208    .0062      .072
#
# 25 is too strong and the reason is worth stating: shrinkage toward 1 is
# right for a cell with two observations and wrong for margin 0, which has
# 168 EXPECTED games and 15 observed. That is not a sparse cell, it is a
# loud signal, and a prior worth 25 games drags it most of the way back to a
# number the data has decisively rejected. 8 keeps the tails civil while
# letting well-populated cells speak.
WEIGHT_ALPHA = 8.0

ARTIFACT_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "models"


@dataclass
class MarginModelParams:
    """Fitted coefficients, persisted alongside the corpus they came from."""

    margin_intercept: float = 2.19
    margin_per_elo: float = 1.0 / 25.0
    margin_sd: float = MARGIN_SD
    total_intercept: float = 44.53
    total_sd: float = TOTAL_SD
    margin_total_corr: float = 0.0
    home_advantage_points: float = 2.1
    n_train: int = 0
    trained_through: Optional[str] = None

    def as_dict(self) -> Dict:
        return asdict(self)


@dataclass
class GameForecast:
    """One game's full forecast.

    Every number here is derived from the same lattice distribution. There is
    no second, independently-computed win probability to drift out of sync.
    """

    p_home: float
    p_tie: float
    p_away: float
    exp_margin: float
    exp_total: float
    margin_sd: float
    total_sd: float
    exp_home_score: float
    exp_away_score: float
    # P(margin = k) for k in `lattice`. The single source of every
    # margin-derived quantity below.
    lattice: np.ndarray = field(repr=False, default=None)  # type: ignore[assignment]
    lattice_pmf: np.ndarray = field(repr=False, default=None)  # type: ignore[assignment]

    # ------------------------------------------------------------ spread

    def cover_probabilities(
        self, spread_home: float
    ) -> Tuple[float, float, float]:
        """(home covers, push, away covers) at the book's sign convention.

        `spread_home = -3` means the home side gives 3, so it covers by
        winning by 4 or more and pushes on exactly 3.

        **The push is returned rather than folded away**, because at the
        NFL's key numbers it is not a rounding detail: a line of -3 pushes on
        14.8% of games. Splitting that mass between the two sides — which is
        what any continuous model does implicitly — misprices the most
        heavily traded number in the sport by more than the entire edge this
        project claims anywhere.

        A half-point line pushes with probability zero, correctly and
        automatically, because no integer margin equals it.
        """
        threshold = -float(spread_home)
        pmf, lattice = self.lattice_pmf, self.lattice
        push = float(pmf[np.isclose(lattice, threshold)].sum())
        home = float(pmf[lattice > threshold].sum())
        away = float(pmf[lattice < threshold].sum())
        return home, push, away

    def cover_probability(self, spread_home: float) -> float:
        """P(home covers | no push) — the number a price implies.

        A pushed bet is returned, so the quantity a -110 line is offering
        odds on is conditional on the game not landing exactly on the number.
        """
        home, push, away = self.cover_probabilities(spread_home)
        decided = home + away
        return home / decided if decided > 0 else 0.5

    # ------------------------------------------------------------- total

    def over_probability(self, total_line: float) -> float:
        """P(total > line), from the normal.

        The total keeps the plain normal deliberately. Totals are sums rather
        than differences, so the 3s and 7s of the two sides convolve and wash
        out: the measured lattice weight on the total is inside the shrinkage
        band almost everywhere, which is to say there is nothing there to
        model. Using the same machinery anyway would imply a structure that
        was looked for and not found.
        """
        return 1.0 - _normal_cdf(
            (float(total_line) - self.exp_total) / self.total_sd
        )

    # ------------------------------------------------------- publishing

    def margin_distribution(
        self, *, low: int = -28, high: int = 28
    ) -> Dict[str, object]:
        """The margin lattice, trimmed for publication.

        Published so the game page can DRAW the distribution rather than
        recompute it. The frontend never computes a probability — a component
        that did would be a second model nobody benchmarked — and this is the
        artifact that lets it show football's 3s and 7s honestly.

        The window is +/-28 rather than the full +/-70 because the tails carry
        under a tenth of a percent between them and 272 games of trailing
        zeros is real bytes on a static site. `outside` records the mass that
        was trimmed, so the chart can say so instead of implying the
        distribution ends.
        """
        mask = (self.lattice >= low) & (self.lattice <= high)
        inside = self.lattice_pmf[mask]
        return {
            "low": int(low),
            "high": int(high),
            "p": [round(float(v), 5) for v in inside],
            "outside": round(float(1.0 - inside.sum()), 5),
        }

    def spread_surface(self, lines: Sequence[float]) -> List[Dict[str, float]]:
        """Cover / push / away-cover at each line, published.

        **The push column is the reason this exists.** At a line of exactly
        -3 a bet on the favourite can win, lose or push, and the push is worth
        about one game in twelve. Every continuous model assigns it zero by
        construction and silently splits that mass between the two sides — on
        the most heavily traded number in the sport.
        """
        out: List[Dict[str, float]] = []
        for line in lines:
            home, push, away = self.cover_probabilities(float(line))
            out.append({
                "line": float(line),
                "home_cover": round(home, 5),
                "push": round(push, 5),
                "away_cover": round(away, 5),
            })
        return out

    def as_dict(self) -> Dict:
        return {
            "p_home": round(self.p_home, 6),
            "p_tie": round(self.p_tie, 6),
            "p_away": round(self.p_away, 6),
            "exp_margin": round(self.exp_margin, 3),
            "exp_total": round(self.exp_total, 2),
            "exp_home_score": round(self.exp_home_score, 2),
            "exp_away_score": round(self.exp_away_score, 2),
            "margin_sd": round(self.margin_sd, 3),
            "total_sd": round(self.total_sd, 3),
        }


class MarginModel:
    """Fits and serves the margin/total forecaster."""

    def __init__(self, params: Optional[MarginModelParams] = None):
        self.params = params or MarginModelParams()
        self._margin_coef: Optional[np.ndarray] = None
        self._total_coef: Optional[np.ndarray] = None
        self.feature_names: List[str] = []
        self.lattice = np.arange(LATTICE_LOW, LATTICE_HIGH + 1)
        # Defaults to a flat lattice — i.e. exactly a discretised normal —
        # so an unfitted model degrades to the NBA project's behaviour rather
        # than to nonsense.
        self.key_weights = np.ones_like(self.lattice, dtype=float)

    # --------------------------------------------------------------- fit

    def fit_key_numbers(
        self,
        margins: Sequence[float],
        predicted_means: Optional[Sequence[float]] = None,
        sd: Optional[float] = None,
    ) -> np.ndarray:
        """Measure the lattice weight `w(k)` from observed margins.

        `w(k)` is the ratio of the empirical frequency of margin k to what
        the model's own smooth kernel expects there, shrunk toward 1 by
        `WEIGHT_ALPHA` so sparse cells do not chase noise.

        Fitted on RAW margins rather than on model residuals, and that is the
        substantive choice. The key-number structure is a property of how
        points are scored, not of how well the model predicted the game: a
        3-point margin is over-represented whether the game was a pick'em or
        a mismatch. Residuals are measured against a continuously varying
        mean, which smears the lattice away and would find nothing.

        **The denominator is the MIXTURE over the training set's predicted
        means, not a single normal**, whenever `predicted_means` is supplied.
        That distinction is not pedantry, it is what makes the model
        self-consistent: the served kernel uses the RESIDUAL sd (13.2) while
        the raw margins carry the UNCONDITIONAL sd (14.6), because the latter
        also contains the spread of team strength. Dividing by a single
        normal at the unconditional sd and then serving a narrower one leaves
        a systematic surplus of mass at the centre — it inflated the served
        tie probability to 0.62% against a measured 0.241%.

        Against the true mixture, `sum_i N(k; mu_i, sigma) / n`, the weights
        are exactly the correction that makes the AVERAGE served PMF
        reproduce the empirical one. The tie probability then falls out
        right instead of being tuned.
        """
        values = np.asarray(margins, dtype=float)
        if len(values) < 500:
            raise ValueError(
                f"refusing to fit key numbers on {len(values)} games — "
                "the sparse cells would be noise"
            )
        counts = np.array(
            [float((values == k).sum()) for k in self.lattice], dtype=float
        )

        if predicted_means is not None:
            sigma = float(sd if sd is not None else self.params.margin_sd)
            mus = np.asarray(predicted_means, dtype=float)
            # Mixture density on the lattice: mean over training games of the
            # kernel this model will actually serve.
            grid = self.lattice[:, None].astype(float)
            density = _normal_pdf_grid(grid, mus[None, :], sigma).mean(axis=1)
            expected = density * len(values)
        else:
            # Standalone fallback: one normal at the unconditional moments.
            # Documented as an approximation because it is one.
            expected = _normal_pdf(
                self.lattice, float(values.mean()), float(values.std())
            ) * len(values)

        self.key_weights = (counts + WEIGHT_ALPHA) / (expected + WEIGHT_ALPHA)
        return self.key_weights

    def fit(
        self,
        features: np.ndarray,
        margins: np.ndarray,
        totals: np.ndarray,
        feature_names: Sequence[str],
        *,
        ridge: float = 1.0,
        trained_through: Optional[str] = None,
        fit_key_numbers: bool = True,
    ) -> MarginModelParams:
        """Ridge-fit margin and total on the same design matrix.

        Ridge rather than OLS because the feature blocks (Elo difference,
        rolling efficiency, rest) are collinear by construction — they are
        all measuring team strength — and OLS splits weight between them
        arbitrarily from fold to fold. The penalty is small; its job is
        stability, not shrinkage.
        """
        X = np.asarray(features, dtype=float)
        if X.ndim != 2:
            raise ValueError("features must be 2-D")
        y_margin = np.asarray(margins, dtype=float)
        y_total = np.asarray(totals, dtype=float)
        if not (len(X) == len(y_margin) == len(y_total)):
            raise ValueError("features, margins and totals must align")
        if len(X) < 100:
            raise ValueError(
                f"refusing to fit on {len(X)} games — that is not a corpus"
            )

        design = np.hstack([np.ones((len(X), 1)), X])
        self.feature_names = list(feature_names)

        self._margin_coef = _ridge_solve(design, y_margin, ridge)
        self._total_coef = _ridge_solve(design, y_total, ridge)

        margin_resid = y_margin - design @ self._margin_coef
        total_resid = y_total - design @ self._total_coef

        # ddof accounts for the parameters spent; with thousands of games and
        # a handful of features it barely moves, but a fit on one season
        # would otherwise report an optimistic sigma.
        dof = max(1, len(X) - design.shape[1])
        self.params.margin_sd = float(np.sqrt((margin_resid ** 2).sum() / dof))
        self.params.total_sd = float(np.sqrt((total_resid ** 2).sum() / dof))
        self.params.margin_intercept = float(self._margin_coef[0])
        self.params.total_intercept = float(self._total_coef[0])
        self.params.n_train = int(len(X))
        self.params.trained_through = trained_through
        if len(margin_resid) > 2 and total_resid.std() > 0 and margin_resid.std() > 0:
            self.params.margin_total_corr = float(
                np.corrcoef(margin_resid, total_resid)[0, 1]
            )

        if fit_key_numbers and len(y_margin) >= 500:
            # Fitted AFTER the ridge, against this model's own predicted
            # means, so the weights correct the kernel that will actually be
            # served rather than an unconditional stand-in for it.
            self.fit_key_numbers(
                y_margin,
                predicted_means=design @ self._margin_coef,
                sd=self.params.margin_sd,
            )

        return self.params

    # ------------------------------------------------------------ serve

    def predict(self, features: np.ndarray) -> List[GameForecast]:
        if self._margin_coef is None or self._total_coef is None:
            raise RuntimeError("model is not fitted")
        X = np.atleast_2d(np.asarray(features, dtype=float))
        design = np.hstack([np.ones((len(X), 1)), X])
        exp_margin = design @ self._margin_coef
        exp_total = design @ self._total_coef
        return [
            self.forecast_from(float(m), float(t))
            for m, t in zip(exp_margin, exp_total)
        ]

    def margin_pmf(self, exp_margin: float, sd: Optional[float] = None) -> np.ndarray:
        """P(margin = k) over the lattice, normalised.

        The one place a margin distribution is produced. Every probability
        this project publishes about a single game is a sum over this array,
        which is what makes "the moneyline and the spread agree" an identity
        rather than an aspiration.
        """
        sigma = float(sd if sd is not None else self.params.margin_sd)
        kernel = _normal_pdf(self.lattice, float(exp_margin), sigma)
        pmf = self.key_weights * kernel
        total = pmf.sum()
        if total <= 0:
            raise RuntimeError("margin pmf collapsed to zero mass")
        return pmf / total

    def forecast_from(self, exp_margin: float, exp_total: float) -> GameForecast:
        """Assemble a forecast from an expected margin and total.

        Every consumer goes through here.
        """
        pmf = self.margin_pmf(exp_margin)
        p_home = float(pmf[self.lattice > 0].sum())
        p_tie = float(pmf[self.lattice == 0].sum())
        p_away = float(pmf[self.lattice < 0].sum())

        return GameForecast(
            p_home=p_home,
            p_tie=p_tie,
            p_away=p_away,
            exp_margin=float(exp_margin),
            exp_total=float(exp_total),
            margin_sd=self.params.margin_sd,
            total_sd=self.params.total_sd,
            exp_home_score=(exp_total + exp_margin) / 2.0,
            exp_away_score=(exp_total - exp_margin) / 2.0,
            lattice=self.lattice,
            lattice_pmf=pmf,
        )

    def predict_from_elo(
        self,
        home_elo: float,
        away_elo: float,
        *,
        neutral: bool = False,
        home_advantage_elo: float = 48.0,
        points_per_elo: float = 25.0,
        exp_total: Optional[float] = None,
    ) -> GameForecast:
        """Forecast from ratings alone — the cold-start and baseline path.

        **This is not the serving path.** `FeatureBuilder.vector_for` is, and
        the two must never be confused: the NBA project shipped a bug where
        this method was called against a 19-feature model, so eighteen
        features fell back to the intercept and the published expected total
        was 14.1 points. It was caught only because a basketball game
        obviously does not end 6-8. A football version of that bug would
        publish a total near 44 and look entirely reasonable.
        """
        edge = 0.0 if neutral else home_advantage_elo
        exp_margin = ((home_elo + edge) - away_elo) / points_per_elo
        return self.forecast_from(
            exp_margin,
            exp_total if exp_total is not None else self.params.total_intercept,
        )

    # ------------------------------------------------------------- io

    def save(self, path: Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "params": self.params.as_dict(),
            "feature_names": self.feature_names,
            "margin_coef": (
                self._margin_coef.tolist() if self._margin_coef is not None else None
            ),
            "total_coef": (
                self._total_coef.tolist() if self._total_coef is not None else None
            ),
            "lattice_low": int(self.lattice[0]),
            "key_weights": self.key_weights.tolist(),
        }
        # temp-file + replace, so a crash mid-write leaves the previous valid
        # artifact serving rather than a truncated one.
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, indent=2))
        tmp.replace(path)
        return path

    @classmethod
    def load(cls, path: Path) -> "MarginModel":
        payload = json.loads(Path(path).read_text())
        model = cls(MarginModelParams(**payload["params"]))
        model.feature_names = payload.get("feature_names") or []
        if payload.get("margin_coef"):
            model._margin_coef = np.asarray(payload["margin_coef"], dtype=float)
        if payload.get("total_coef"):
            model._total_coef = np.asarray(payload["total_coef"], dtype=float)
        if payload.get("key_weights"):
            weights = np.asarray(payload["key_weights"], dtype=float)
            low = int(payload.get("lattice_low", LATTICE_LOW))
            model.lattice = np.arange(low, low + len(weights))
            model.key_weights = weights
        return model


def _ridge_solve(design: np.ndarray, y: np.ndarray, ridge: float) -> np.ndarray:
    """Closed-form ridge, with the intercept left unpenalised.

    Penalising the intercept would shrink the league's average margin toward
    zero and quietly remove home advantage.
    """
    penalty = np.eye(design.shape[1]) * ridge
    penalty[0, 0] = 0.0
    return np.linalg.solve(design.T @ design + penalty, design.T @ y)


def _normal_pdf(x: np.ndarray, mu: float, sd: float) -> np.ndarray:
    sd = max(float(sd), 1e-6)
    z = (np.asarray(x, dtype=float) - mu) / sd
    return np.exp(-0.5 * z * z) / (sd * math.sqrt(2.0 * math.pi))


def _normal_pdf_grid(x: np.ndarray, mu: np.ndarray, sd: float) -> np.ndarray:
    """Broadcasting form: a (lattice x games) density matrix."""
    sd = max(float(sd), 1e-6)
    z = (x - mu) / sd
    return np.exp(-0.5 * z * z) / (sd * math.sqrt(2.0 * math.pi))


def _normal_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))
