"""Monte Carlo season projection.

Simulates the remainder of a season game by game, then seeds each conference,
then runs the postseason bracket, and reports for every franchise: expected
record, seed distribution, division-title odds, playoff odds, conference
title odds and championship odds.

The one decision that must not be casually changed
--------------------------------------------------

Each simulation draws ONE strength offset per franchise and holds it for the
whole season, rather than perturbing each game independently. This is
inherited from the soccer project, where compounding point estimates over 34
matchdays gave Bayern 93.3% against a market price near 70%.

The offset's size is measured, not assumed. Within-season Elo drift over
**768 team-seasons has sd 34.53 rating points**, and — the part that makes
independent per-game noise the wrong model — that error is *correlated across
all of a team's games*. A team that is better than its rating is better in
all 17, so no number of simulations averages it away.

The NBA sibling measured 36.1 and the two are close enough to look
interchangeable. **They are not, and the reason is instructive.** A shock of
the same rating size does far more damage to a 17-game season than to an
82-game one, because there are fewer games to average it out: the sd of a
team's final win TOTAL is dominated by the shock here and by binomial noise
there. Porting the constant would be defensible; porting the intuition that
"season projections are roughly as tight as basketball's" would not be.

Why the win totals are so much wider than basketball's
------------------------------------------------------

A 17-game season is short enough that luck outranks skill over ordinary
ranges. Even with a perfectly known team strength, a true .600 team's record
has a binomial sd of about 2.0 wins over 17 games — more than a fifth of its
expected total. This is not a defect of the model; it is the sport, and it is
why an NFL projection that prints narrow win-total intervals is wrong rather
than confident.

Ties
----

A tie is simulated, at the lattice probability the margin model gives, and it
counts half a win in the standings. The NBA sibling has no branch for this
and is right not to. Here, dropping it would cost about a quarter of a
percent of games — small, until it decides a division.

**Every season seeds its own RNG** from `sha256(season)`. One shared
generator consumed in dict-iteration order means adding a team moves an
unrelated team's title odds with nothing having changed about it. Two runs of
this module are byte-identical.
"""

from __future__ import annotations

import hashlib
import logging
import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from backend.services.playoffs.bracket import (
    TeamRecord,
    seed_conference,
    seeds_per_conference,
    simulate_postseason,
)

logger = logging.getLogger(__name__)

# Measured: sd of a franchise's Elo around its own season mean, over 768
# team-seasons on the 2002-2025 corpus.
SEASON_ELO_DRIFT_SD = 34.53

# Converted to the log-odds scale the win probability lives on.
STRENGTH_SHOCK_SD = SEASON_ELO_DRIFT_SD / 400.0 * math.log(10) / 2.0


@dataclass
class TeamProjection:
    team_id: int
    name: str
    abbreviation: str
    conference: str
    division: str
    wins: float
    losses: float
    ties: float
    wins_p10: float
    wins_p90: float
    p_division: float
    p_playoffs: float
    p_bye: float
    p_top_seed: float
    p_divisional_round: float
    p_conference_game: float
    p_conference_title: float
    p_championship: float
    seed_distribution: Dict[int, float]
    current_wins: float
    current_losses: float
    current_ties: float
    games_left: int
    elo: float

    def as_dict(self) -> Dict:
        return {
            "team_id": self.team_id,
            "name": self.name,
            "abbreviation": self.abbreviation,
            "conference": self.conference,
            "division": self.division,
            "wins": round(self.wins, 2),
            "losses": round(self.losses, 2),
            "ties": round(self.ties, 3),
            "wins_p10": round(self.wins_p10, 1),
            "wins_p90": round(self.wins_p90, 1),
            "p_division": round(self.p_division, 4),
            "p_playoffs": round(self.p_playoffs, 4),
            "p_bye": round(self.p_bye, 4),
            "p_top_seed": round(self.p_top_seed, 4),
            "p_divisional_round": round(self.p_divisional_round, 4),
            "p_conference_game": round(self.p_conference_game, 4),
            "p_conference_title": round(self.p_conference_title, 4),
            "p_championship": round(self.p_championship, 4),
            "seed_distribution": {
                str(k): round(v, 4)
                for k, v in sorted(self.seed_distribution.items())
            },
            "current_wins": self.current_wins,
            "current_losses": self.current_losses,
            "current_ties": self.current_ties,
            "games_left": self.games_left,
            "elo": round(self.elo, 1),
        }


@dataclass
class SeasonSimulationResult:
    season: int
    simulations: int
    teams: List[TeamProjection]
    games_played: int
    games_remaining: int
    generated_at: str

    def as_dict(self) -> Dict:
        return {
            "season": self.season,
            "simulations": self.simulations,
            "games_played": self.games_played,
            "games_remaining": self.games_remaining,
            "generated_at": self.generated_at,
            "teams": [t.as_dict() for t in self.teams],
        }


@dataclass
class Fixture:
    """One remaining game, with its pre-computed lattice probabilities."""

    home_team_id: int
    away_team_id: int
    p_home: float
    p_tie: float
    neutral: bool = False


class SeasonSimulator:
    """Monte Carlo over the remaining schedule plus the postseason."""

    def __init__(
        self,
        *,
        simulations: int = 20000,
        shock_sd: float = STRENGTH_SHOCK_SD,
    ):
        self.simulations = simulations
        self.shock_sd = shock_sd

    def run(
        self,
        season: int,
        teams: Sequence[Dict[str, Any]],
        played: Sequence[Dict[str, Any]],
        remaining: Sequence[Fixture],
        *,
        head_to_head: Optional[Dict[Tuple[int, int], float]] = None,
        generated_at: str = "",
    ) -> SeasonSimulationResult:
        """Project a season.

        `teams` carries identity (team_id, name, conference, division, elo).
        `played` is the games already decided this season.
        `remaining` is every fixture still to come, already priced.
        """
        rng = np.random.default_rng(
            int(hashlib.sha256(str(season).encode()).hexdigest()[:16], 16)
        )

        team_ids = [int(t["team_id"]) for t in teams]
        index_of = {tid: i for i, tid in enumerate(team_ids)}
        n_teams = len(team_ids)
        n_sims = self.simulations

        conference_of = {int(t["team_id"]): t["conference"] for t in teams}
        division_of = {int(t["team_id"]): t["division"] for t in teams}

        # ---- standings already banked, identical in every simulation.
        base_w = np.zeros(n_teams)
        base_l = np.zeros(n_teams)
        base_t = np.zeros(n_teams)
        base_div_w = np.zeros(n_teams)
        base_div_g = np.zeros(n_teams)
        base_conf_w = np.zeros(n_teams)
        base_conf_g = np.zeros(n_teams)
        h2h: Dict[Tuple[int, int], float] = dict(head_to_head or {})

        for game in played:
            h, a = int(game["home_team_id"]), int(game["away_team_id"])
            if h not in index_of or a not in index_of:
                continue
            hi, ai = index_of[h], index_of[a]
            hs, as_ = float(game["home_score"]), float(game["away_score"])
            same_div = division_of[h] == division_of[a]
            same_conf = conference_of[h] == conference_of[a]
            for i, j, score, other in ((hi, ai, hs, as_), (ai, hi, as_, hs)):
                if same_div:
                    base_div_g[i] += 1
                if same_conf:
                    base_conf_g[i] += 1
            if hs == as_:
                base_t[hi] += 1; base_t[ai] += 1
                if same_div:
                    base_div_w[hi] += 0.5; base_div_w[ai] += 0.5
                if same_conf:
                    base_conf_w[hi] += 0.5; base_conf_w[ai] += 0.5
            else:
                wi, li = (hi, ai) if hs > as_ else (ai, hi)
                base_w[wi] += 1; base_l[li] += 1
                if same_div:
                    base_div_w[wi] += 1
                if same_conf:
                    base_conf_w[wi] += 1

        # ---- per-simulation strength shock, one per team per season.
        shocks = rng.normal(0.0, self.shock_sd, size=(n_sims, n_teams))

        wins = np.tile(base_w, (n_sims, 1))
        losses = np.tile(base_l, (n_sims, 1))
        ties = np.tile(base_t, (n_sims, 1))
        div_w = np.tile(base_div_w, (n_sims, 1))
        div_g = np.tile(base_div_g, (n_sims, 1))
        conf_w = np.tile(base_conf_w, (n_sims, 1))
        conf_g = np.tile(base_conf_g, (n_sims, 1))

        # ---- play out the remaining schedule, vectorised over simulations.
        for fixture in remaining:
            hi = index_of.get(fixture.home_team_id)
            ai = index_of.get(fixture.away_team_id)
            if hi is None or ai is None:
                continue

            p_tie = float(fixture.p_tie)
            # Shift the DECIDED probability by the strength shock on the
            # log-odds scale, then restore the tie mass. Perturbing p_home
            # directly would let a large shock push it past 1 - p_tie.
            decided = max(1.0 - p_tie, 1e-9)
            p_home_cond = min(max(float(fixture.p_home) / decided, 1e-6), 1 - 1e-6)
            logit = math.log(p_home_cond / (1.0 - p_home_cond))
            adjusted = 1.0 / (1.0 + np.exp(-(logit + shocks[:, hi] - shocks[:, ai])))

            draw = rng.random(n_sims)
            is_tie = draw < p_tie
            home_win = (~is_tie) & (draw < p_tie + (1.0 - p_tie) * adjusted)
            away_win = (~is_tie) & (~home_win)

            wins[:, hi] += home_win
            wins[:, ai] += away_win
            losses[:, hi] += away_win
            losses[:, ai] += home_win
            ties[:, hi] += is_tie
            ties[:, ai] += is_tie

            same_div = division_of[fixture.home_team_id] == division_of[fixture.away_team_id]
            same_conf = conference_of[fixture.home_team_id] == conference_of[fixture.away_team_id]
            if same_div:
                div_g[:, hi] += 1; div_g[:, ai] += 1
                div_w[:, hi] += home_win + 0.5 * is_tie
                div_w[:, ai] += away_win + 0.5 * is_tie
            if same_conf:
                conf_g[:, hi] += 1; conf_g[:, ai] += 1
                conf_w[:, hi] += home_win + 0.5 * is_tie
                conf_w[:, ai] += away_win + 0.5 * is_tie

        # ---- seed, then run the bracket, one simulation at a time.
        n_seeds = seeds_per_conference(season)
        seed_counts = np.zeros((n_teams, n_seeds + 1))
        division_titles = np.zeros(n_teams)
        playoff_hits = np.zeros(n_teams)
        bye_hits = np.zeros(n_teams)
        round_hits = {
            "divisional": np.zeros(n_teams),
            "conference": np.zeros(n_teams),
            "conf_title": np.zeros(n_teams),
            "championship": np.zeros(n_teams),
        }

        conferences = sorted({c for c in conference_of.values() if c})
        by_conference = {
            conf: [tid for tid in team_ids if conference_of[tid] == conf]
            for conf in conferences
        }

        elo_of = {int(t["team_id"]): float(t.get("elo", 1500.0)) for t in teams}

        for sim in range(n_sims):
            seeded: Dict[str, List[int]] = {}
            for conf, members in by_conference.items():
                records = [
                    TeamRecord(
                        team_id=tid,
                        wins=float(wins[sim, index_of[tid]]),
                        losses=float(losses[sim, index_of[tid]]),
                        ties=float(ties[sim, index_of[tid]]),
                        division=division_of[tid],
                        conference=conf,
                        division_wins=float(div_w[sim, index_of[tid]]),
                        division_games=float(div_g[sim, index_of[tid]]),
                        conference_wins=float(conf_w[sim, index_of[tid]]),
                        conference_games=float(conf_g[sim, index_of[tid]]),
                    )
                    for tid in members
                ]
                ordered = seed_conference(records, season, head_to_head=h2h)
                ids = [r.team_id for r in ordered]
                seeded[conf] = ids
                for seed_index, tid in enumerate(ids, start=1):
                    i = index_of[tid]
                    seed_counts[i, seed_index] += 1
                    playoff_hits[i] += 1
                    if seed_index <= (1 if season >= 2020 else 2):
                        bye_hits[i] += 1
                # Division titles are the top four seeds by construction.
                for tid in ids[:4]:
                    division_titles[index_of[tid]] += 1

            if len(conferences) < 2:
                continue

            def play(home: int, away: int, neutral: bool) -> int:
                """One postseason game, priced off Elo plus the shock."""
                edge = 0.0 if neutral else 48.0
                diff = (
                    (elo_of.get(home, 1500.0) + edge) - elo_of.get(away, 1500.0)
                ) / 400.0 * math.log(10)
                diff += shocks[sim, index_of[home]] - shocks[sim, index_of[away]]
                p_home = 1.0 / (1.0 + math.exp(-diff))
                return home if rng.random() < p_home else away

            log: List[Any] = []
            champion, afc, nfc = simulate_postseason(
                seeded[conferences[0]], seeded[conferences[1]], season, play, log=log
            )
            for game in log:
                for tid in (game.home_team_id, game.away_team_id):
                    key = {
                        "wild-card": None,
                        "divisional": "divisional",
                        "conference": "conference",
                        "super-bowl": "conf_title",
                    }.get(game.round_slug)
                    if key:
                        round_hits[key][index_of[tid]] += 1
            round_hits["championship"][index_of[champion]] += 1

        # ---- assemble
        projections: List[TeamProjection] = []
        for team in teams:
            tid = int(team["team_id"])
            i = index_of[tid]
            final_w = wins[:, i]
            games_left = sum(
                1 for f in remaining
                if f.home_team_id == tid or f.away_team_id == tid
            )
            projections.append(
                TeamProjection(
                    team_id=tid,
                    name=str(team.get("display_name") or ""),
                    abbreviation=str(team.get("abbreviation") or ""),
                    conference=str(conference_of.get(tid) or ""),
                    division=str(division_of.get(tid) or ""),
                    wins=float(final_w.mean()),
                    losses=float(losses[:, i].mean()),
                    ties=float(ties[:, i].mean()),
                    wins_p10=float(np.percentile(final_w, 10)),
                    wins_p90=float(np.percentile(final_w, 90)),
                    p_division=float(division_titles[i] / n_sims),
                    p_playoffs=float(playoff_hits[i] / n_sims),
                    p_bye=float(bye_hits[i] / n_sims),
                    p_top_seed=float(seed_counts[i, 1] / n_sims),
                    p_divisional_round=float(round_hits["divisional"][i] / n_sims),
                    p_conference_game=float(round_hits["conference"][i] / n_sims),
                    p_conference_title=float(round_hits["conf_title"][i] / n_sims),
                    p_championship=float(round_hits["championship"][i] / n_sims),
                    seed_distribution={
                        s: float(seed_counts[i, s] / n_sims)
                        for s in range(1, n_seeds + 1)
                        if seed_counts[i, s] > 0
                    },
                    current_wins=float(base_w[i]),
                    current_losses=float(base_l[i]),
                    current_ties=float(base_t[i]),
                    games_left=games_left,
                    elo=elo_of.get(tid, 1500.0),
                )
            )

        projections.sort(key=lambda p: -p.p_championship)
        return SeasonSimulationResult(
            season=season,
            simulations=n_sims,
            teams=projections,
            games_played=len(played),
            games_remaining=len(remaining),
            generated_at=generated_at,
        )
