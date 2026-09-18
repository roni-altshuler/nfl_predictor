# Continued model and fan-experience improvements

This pass continues the NFL platform work. It includes the preceding Forecast Lab
and forecast-history safeguards, and adds the changes below.

## A model bug corrected: head-to-head results in season simulations

The seeding function supported head-to-head tiebreaks, but `SeasonSimulator`
never constructed them from completed games or sampled remaining fixtures.
The publisher did not supply the optional map either. Consequently, the season
projection ignored the first tiebreaker even when the outcome was known.

The simulator now tracks actual and sampled meeting points and counts for each
pair. Ties count as half a win; home/away rematches are combined before computing
the head-to-head percentage. Each simulated season passes its own results into
seeding. Tests include a division winner that changes when this information is
used, split series, ties, malformed inputs and deterministic row reordering.

Teams and fixtures are canonically ordered before random draws, so changing
provider row order does not change a seeded projection. Scenario collection uses
those same draws without altering the baseline. The simulator is identified as
`nfl-season-h2h-2`; the game model remains `nfl-margin-lattice-1`.

This is a structural correctness fix, not a demonstrated improvement in Brier
score. The existing multi-team sweep shortcut, common-games and deeper
tiebreakers remain areas for further work; the incomplete seeding rules are stated
in the product. The [NFL's procedure](https://www.nfl.com/standings/tie-breaking-procedures)
is the reference for the distinction between those steps.

## Conditional playoff exploration

The new January effect panel answers: among the simulated seasons where this
team won this game, how often did each team qualify, win its division or win the
Super Bowl? It is a conditional slice of a joint season simulation. It preserves
shared team-strength uncertainty and does not claim the causal effect of forcing
a result.

- 20,000 simulations, next available week, both sides of each game.
- Baseline and conditional outlooks come from the same simulation run.
- Every branch reports its sample count. Branches below 200 samples are withheld,
  including the sparse tie branches in the current artifact.
- Wilson intervals describe Monte Carlo precision only. They are not confidence
  intervals for real-world model accuracy.
- The panel shows changes for the two participants and the three largest changes
  elsewhere in the race. Small changes can be simulation noise.
- Frontend validation requires coherent team identities, sample counts, intervals,
  model/season/timestamp matches, and complete branches. The server also verifies
  the SHA-256 of the source game forecast file.

The warehouse release download failed in both GitHub CLI and curl with TLS
connection timeouts. `build_playoff_scenarios` therefore rebuilt the new companion
artifact from the committed forecast, ratings, actual results and standings.
It verifies publication matches, game counts and every team's current record.
It does not alter previously published game probabilities or historical forecast
snapshots. The companion artifact keeps its source publication time separately
from its computation time. Existing season projections may precede this simulator;
the panel identifies its own baseline and version. Future daily forecasts produce
scenarios and season projections in the same run.

## A second probability-model experiment

Protocol fixed before scoring: fit a convex margin/Elo blend by Brier loss, then
fit a sigmoid mapping with an identity penalty of 10. Both layers train on earlier
out-of-sample predictions only. Each test week uses at least 500 prior forecasts
and a one-day result-availability lag. Tests prove that changing held-out labels
cannot change that week's predictions. No additional Python dependency is needed.

The design follows the requirement for independent calibration observations in
[scikit-learn's calibration guidance](https://scikit-learn.org/1.8/modules/calibration.html).
Brier and log loss measure probability quality; winner accuracy alone is not a
sufficient promotion rule.

Exploratory results, 1,136 decided games from 2022–2025, 88 week blocks:

| Model | Brier | Log loss | Winner accuracy |
| --- | ---: | ---: | ---: |
| Incumbent margin | 0.222241 | 0.634440 | 63.38% |
| Elo | 0.222187 | 0.634731 | 63.91% |
| Fixed equal blend | 0.221908 | 0.633852 | 64.00% |
| Learned blend + calibration | 0.222829 | 0.636538 | 64.44% |

Learned candidate minus incumbent Brier: +0.000588, 95% week-block bootstrap
interval [−0.001982, +0.003136], 4,000 draws. The learned candidate is held out of
production despite higher winner accuracy. The equal blend is a useful future
candidate, not an established gain; no prospective test or reconciliation with
the full served margin lattice has been completed. These historical results use
the older local corpus through the 2025 postseason and are not a refreshed live
benchmark. Full rows and hashes: `reports/calibration_experiment.json`.

## Website design

The homepage now begins with a compact weekly briefing: next kickoff, closest
matchup and largest simulated playoff swing. Each card opens the relevant Lab
fixture. The briefing hides games after kickoff using the browser clock. It sends
only the small data fields it renders to the browser, not full simulation tables.

The Lab adds the conditional outlook with a labelled baseline marker, result
controls, sample sizes and a collapsible explanation. The previous record-only
calculator is preserved under a disclosure so it does not compete with the more
useful season outlook. The existing chalkboard theme and reduced-motion behavior
remain intact.

The accuracy page now includes a public research ledger. Both rejected experiments
are visible with paired score changes and intervals, separate from the published
live record and production historical benchmark. Model development does not erase
failed experiments or advertise winner accuracy as probability improvement.

## Verification and continued priorities

See [the verification record](VERIFICATION_2026-09-18.md) for final checks and
screenshots. CI now runs the production Chromium audit after build; its browser
clock uses the artifact publication time so aging fixtures do not make the test
unreproducible. Local review uses the actual current clock.

The next model priorities are timestamped quarterback/roster inputs, verified
historical feature coverage, complete tiebreaker rules, and an untouched prospective
comparison of a lattice-consistent ensemble. The next product priorities are
measuring return visits and fixture-to-detail navigation, and comparing the
conditional season projections with actual outcomes as the sample grows.
