"""The NFL postseason: seeding, reseeding and single-elimination bracket.

**Almost nothing here ports from the sibling NBA project, and the parts that
look portable are the dangerous ones.** That project's playoff layer models
best-of-seven series with home-court patterns and prices them by exact
enumeration over game outcomes. Football plays one game per round. A series
object would be modelling a thing that does not exist.

Four structural facts, each of which changes an answer
------------------------------------------------------

1. **A division winner always outranks a wild card, whatever the records
   say.** The four division winners take seeds 1-4 ordered among themselves;
   the wild cards take 5-7 ordered among themselves. A 9-8 division champion
   hosts a 13-4 wild card, and this is not a rare edge case — it happens most
   seasons and it happened in the year a 7-9 team won a division and hosted a
   playoff game.

   The NBA seeds strictly by record within a conference, so a projection
   ported from it would systematically misprice exactly the teams whose
   seeding is most interesting. `seed_conference` refuses to sort on record
   alone.

2. **The field changed size in 2020**, from 12 teams to 14. Before: six per
   conference, seeds 1 AND 2 both get byes, wild-card weekend is 3v6 and 4v5.
   After: seven per conference, only seed 1 rests, wild-card weekend is 2v7,
   3v6 and 4v5. `field_size` resolves it by season; hard-coding either shape
   silently rewrites twenty seasons of history or every future one.

3. **The bracket RESEEDS after every round.** The highest surviving seed
   plays the lowest surviving seed, every round, so who a team meets in the
   divisional round depends on results in games it was not playing in. A
   fixed bracket — which is what the NBA plays and what any bracket-shaped
   data structure naturally encodes — gives materially different advancement
   probabilities for the same inputs.

4. **The Super Bowl is at a neutral site.** Every other postseason game is
   hosted by the better seed. A conference champion's home advantage simply
   stops applying in the last game, and a simulator that keeps applying it
   hands the higher-rated conference champion a few percent it has not
   earned.

Home advantage in the postseason is the higher seed's, unconditionally —
there is no 2-2-1-1-1 pattern to get right because there is only one game.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

# Seeds per conference, by era.
SEEDS_MODERN = 7      # 2020-, one bye
SEEDS_LEGACY = 6      # 2002-2019, two byes

ROUND_WILD_CARD = "wild-card"
ROUND_DIVISIONAL = "divisional"
ROUND_CONFERENCE = "conference"
ROUND_SUPER_BOWL = "super-bowl"

ROUND_ORDER = (ROUND_WILD_CARD, ROUND_DIVISIONAL, ROUND_CONFERENCE, ROUND_SUPER_BOWL)


def seeds_per_conference(season: int) -> int:
    """7 from 2020, 6 before.

    The 2020 expansion added a wild card to each conference and removed the
    second bye. Both halves of that change matter: a projection that adds the
    seventh seed but keeps two byes gives the second seed a week off it did
    not get.
    """
    return SEEDS_MODERN if season >= 2020 else SEEDS_LEGACY


def byes_per_conference(season: int) -> int:
    """1 from 2020, 2 before."""
    return 1 if season >= 2020 else 2


def field_size(season: int) -> int:
    """Total playoff teams: 14 from 2020, 12 before."""
    return 2 * seeds_per_conference(season)


@dataclass
class TeamRecord:
    """What seeding needs to know about one team's season."""

    team_id: int
    wins: float
    losses: float
    ties: float = 0.0
    division: Optional[str] = None
    conference: Optional[str] = None
    division_wins: float = 0.0
    division_games: float = 0.0
    conference_wins: float = 0.0
    conference_games: float = 0.0

    @property
    def win_pct(self) -> float:
        """Win percentage, with a tie counting as half a win.

        This is the league's own definition and it is not decorative: a
        16-0-1 season and a 16-1-0 season are different, and the tie-bearing
        team is ahead. Treating a tie as a loss — which is what happens if
        you compute wins / (wins + losses) and forget the third column —
        moves real teams past each other in the standings.
        """
        played = self.wins + self.losses + self.ties
        if played <= 0:
            return 0.0
        return (self.wins + 0.5 * self.ties) / played

    @property
    def division_pct(self) -> float:
        if self.division_games <= 0:
            return 0.0
        return self.division_wins / self.division_games

    @property
    def conference_pct(self) -> float:
        if self.conference_games <= 0:
            return 0.0
        return self.conference_wins / self.conference_games


def _tiebreak_key(record: TeamRecord) -> Tuple[float, ...]:
    """Ordering key, best first, over the tiebreakers this project models.

    The NFL's published tiebreaker procedure runs to twelve steps and
    includes strength of victory, strength of schedule and, ultimately, a
    coin toss. This implements the first four that actually resolve almost
    every case — win percentage, head-to-head (applied separately, below),
    division record, conference record — and then breaks any remainder
    **deterministically on team id**.

    That last step is a deliberate, stated approximation rather than a
    modelling claim. What it must not be is *random per simulation*: a
    coin-flip tiebreak evaluated inside a Monte Carlo loop adds variance to
    seed distributions that looks like genuine uncertainty and is not. What
    it also must not be is *biased by construction* — but a stable id order
    is exactly as arbitrary as the coin toss it replaces, and it is
    reproducible, which the coin toss is not.
    """
    return (
        -record.win_pct,
        -record.division_pct,
        -record.conference_pct,
        record.team_id,
    )


def _head_to_head_adjust(
    tied: List[TeamRecord], head_to_head: Dict[Tuple[int, int], float]
) -> List[TeamRecord]:
    """Order a tied group, applying head-to-head where it is decisive.

    Head-to-head is the NFL's first tiebreaker and it is only well-defined
    for two teams (for three or more the league uses a sweep rule). Applied
    here for the two-team case, which is the overwhelming majority; larger
    groups fall through to the record-based key.
    """
    if len(tied) != 2:
        return sorted(tied, key=_tiebreak_key)
    a, b = tied
    result = head_to_head.get((a.team_id, b.team_id))
    if result is None or result == 0.5:
        return sorted(tied, key=_tiebreak_key)
    return [a, b] if result > 0.5 else [b, a]


def seed_conference(
    records: Sequence[TeamRecord],
    season: int,
    *,
    head_to_head: Optional[Dict[Tuple[int, int], float]] = None,
) -> List[TeamRecord]:
    """Order one conference into playoff seeds, best first.

    **Division winners first, then wild cards** — the rule that makes this
    function necessary at all. Returns only the qualifying teams, which is
    `seeds_per_conference(season)` of them.
    """
    head_to_head = head_to_head or {}

    by_division: Dict[str, List[TeamRecord]] = {}
    for record in records:
        by_division.setdefault(record.division or "", []).append(record)

    winners: List[TeamRecord] = []
    for division, members in by_division.items():
        ordered = sorted(members, key=_tiebreak_key)
        # Resolve a two-way tie at the top of a division on head-to-head.
        if len(ordered) >= 2 and _tiebreak_key(ordered[0])[:1] == _tiebreak_key(ordered[1])[:1]:
            ordered[:2] = _head_to_head_adjust(ordered[:2], head_to_head)
        winners.append(ordered[0])

    winner_ids = {record.team_id for record in winners}
    contenders = [r for r in records if r.team_id not in winner_ids]

    winners_sorted = sorted(winners, key=_tiebreak_key)
    wildcards_sorted = sorted(contenders, key=_tiebreak_key)

    n_seeds = seeds_per_conference(season)
    n_wildcards = n_seeds - len(winners_sorted)
    return winners_sorted + wildcards_sorted[:max(n_wildcards, 0)]


# --------------------------------------------------------------- bracket


@dataclass
class PlayoffGame:
    """One postseason game, as simulated."""

    round_slug: str
    conference: Optional[str]
    home_seed: int
    away_seed: int
    home_team_id: int
    away_team_id: int
    winner_team_id: int
    neutral: bool = False


def simulate_conference(
    seeds: Sequence[int],
    season: int,
    play_game: Callable[[int, int, bool], int],
    *,
    conference: Optional[str] = None,
    log: Optional[List[PlayoffGame]] = None,
) -> int:
    """Run one conference's bracket and return the champion's team id.

    `seeds` is team ids in seed order, best first. `play_game(home, away,
    neutral)` returns the winning team id.

    **Reseeding is the whole body of this function.** After each round the
    survivors are re-sorted by their original seed and the best plays the
    worst, which is why this cannot be expressed as a static bracket tree.
    """
    n_seeds = seeds_per_conference(season)
    if len(seeds) != n_seeds:
        raise ValueError(
            f"season {season} seeds {n_seeds} teams per conference, got {len(seeds)}"
        )
    n_byes = byes_per_conference(season)

    # seed index (0-based) -> team id, so survivors can be re-sorted by seed.
    seed_of = {team_id: index for index, team_id in enumerate(seeds)}

    alive = list(seeds)
    round_index = 0
    while len(alive) > 1:
        alive.sort(key=lambda t: seed_of[t])
        if round_index == 0 and n_byes:
            resting, playing = alive[:n_byes], alive[n_byes:]
        else:
            resting, playing = [], alive

        survivors: List[int] = list(resting)
        # Best remaining hosts worst remaining: pair from the outside in.
        for offset in range(len(playing) // 2):
            home = playing[offset]
            away = playing[len(playing) - 1 - offset]
            winner = play_game(home, away, False)
            survivors.append(winner)
            if log is not None:
                log.append(
                    PlayoffGame(
                        round_slug=ROUND_ORDER[min(round_index, 2)],
                        conference=conference,
                        home_seed=seed_of[home] + 1,
                        away_seed=seed_of[away] + 1,
                        home_team_id=home,
                        away_team_id=away,
                        winner_team_id=winner,
                    )
                )
        alive = survivors
        round_index += 1

    return alive[0]


def simulate_postseason(
    afc_seeds: Sequence[int],
    nfc_seeds: Sequence[int],
    season: int,
    play_game: Callable[[int, int, bool], int],
    *,
    log: Optional[List[PlayoffGame]] = None,
) -> Tuple[int, int, int]:
    """Both conferences plus the Super Bowl.

    Returns `(champion, afc_champion, nfc_champion)`.

    **The Super Bowl is played with `neutral=True`.** Every other postseason
    game is hosted by the higher seed; this one is at a predetermined site
    that belongs to neither team. Carrying home advantage into it is a small
    error applied to the single most consequential game of the season.
    """
    afc = simulate_conference(
        afc_seeds, season, play_game, conference="AFC", log=log
    )
    nfc = simulate_conference(
        nfc_seeds, season, play_game, conference="NFC", log=log
    )
    # Home/away in the Super Bowl is a coin flip that alternates by
    # conference; with `neutral=True` it carries no advantage, so the
    # ordering here is presentational only.
    champion = play_game(afc, nfc, True)
    if log is not None:
        log.append(
            PlayoffGame(
                round_slug=ROUND_SUPER_BOWL,
                conference=None,
                home_seed=0,
                away_seed=0,
                home_team_id=afc,
                away_team_id=nfc,
                winner_team_id=champion,
                neutral=True,
            )
        )
    return champion, afc, nfc


def rounds_for(season: int) -> List[str]:
    """Round slugs a team can reach, in order.

    Both eras play the same four named rounds; what differs is how many teams
    skip the first one.
    """
    return list(ROUND_ORDER)
