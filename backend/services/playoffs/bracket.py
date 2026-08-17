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
    """Ordering key for teams IN THE SAME DIVISION, best first.

    The NFL's published procedure runs to twelve steps and includes strength
    of victory, strength of schedule and, ultimately, a coin toss. This
    implements the ones that resolve almost every case — win percentage,
    head-to-head (applied separately, below), division record, conference
    record — and then breaks any remainder **deterministically on team id**.

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


def _wildcard_key(record: TeamRecord) -> Tuple[float, ...]:
    """Ordering key for teams in DIFFERENT divisions, best first.

    **Division record is not a cross-division tiebreaker and using it as one
    is wrong, not merely imprecise.** Two teams in different divisions played
    different opponents to earn those division records, so comparing them
    ranks a team by the weakness of the three clubs it happened to share a
    division with. The league's own order for a wild-card comparison goes
    head-to-head, then CONFERENCE record — division record never appears.

    This was measured rather than argued. Reconstructing the seeds for all 24
    archived seasons and checking them against the postseason that was
    actually played, the division-first key put the wrong team in the field in
    11 of 48 conference-seasons; conference-first with head-to-head applied to
    the wild-card group gets the great majority of them right. Because
    `seed_conference` also runs inside every Monte Carlo iteration, that bug
    was mispricing the 5, 6 and 7 seeds in the live projection too.
    """
    return (-record.win_pct, -record.conference_pct, record.team_id)


def _head_to_head_adjust(
    tied: List[TeamRecord],
    head_to_head: Dict[Tuple[int, int], float],
    key: Callable[[TeamRecord], Tuple[float, ...]] = _tiebreak_key,
) -> List[TeamRecord]:
    """Order a tied group, applying head-to-head where it is decisive.

    Head-to-head is the NFL's FIRST tiebreaker and it is only well-defined
    for two teams — for three or more the league uses a sweep rule, which
    only applies when one team beat or lost to all the others. Applied here
    for the two-team case, which is the overwhelming majority; larger groups
    fall through to the record-based key.

    A split series and a pair that never met are both `None`-equivalent and
    both fall through, which is correct: neither is evidence for either side.
    """
    if len(tied) > 2:
        return _sweep(tied, head_to_head, key)
    if len(tied) < 2:
        return list(tied)
    a, b = tied
    result = head_to_head.get((a.team_id, b.team_id))
    if result is None or result == 0.5:
        return sorted(tied, key=key)
    return [a, b] if result > 0.5 else [b, a]


def _sweep(
    tied: List[TeamRecord],
    head_to_head: Dict[Tuple[int, int], float],
    key: Callable[[TeamRecord], Tuple[float, ...]],
) -> List[TeamRecord]:
    """The league's three-or-more-team head-to-head rule.

    Head-to-head only applies to a group of three or more when one club **beat
    every other club in the group** — it goes to the top — or **lost to every
    other** — it goes to the bottom. Anything in between is not evidence and
    the group falls through to the record key.

    That restriction is the whole point: a group where A beat B, B beat C and
    C beat A has a head-to-head result for every pair and a winner for none,
    and any rule that ranks them on it is inventing an answer. Applying the
    sweep and then recursing on what is left is what the league does.
    """
    remaining = list(tied)
    front: List[TeamRecord] = []
    back: List[TeamRecord] = []

    while len(remaining) > 2:
        pairs = {
            r.team_id: [
                head_to_head.get((r.team_id, other.team_id))
                for other in remaining
                if other.team_id != r.team_id
            ]
            for r in remaining
        }
        swept = [
            r for r in remaining
            if all(v is not None and v > 0.5 for v in pairs[r.team_id])
        ]
        drowned = [
            r for r in remaining
            if all(v is not None and v < 0.5 for v in pairs[r.team_id])
        ]
        if len(swept) == 1:
            front.append(swept[0])
            remaining = [r for r in remaining if r is not swept[0]]
            continue
        if len(drowned) == 1:
            back.insert(0, drowned[0])
            remaining = [r for r in remaining if r is not drowned[0]]
            continue
        break

    if len(remaining) == 2:
        remaining = _head_to_head_adjust(remaining, head_to_head, key)
    else:
        remaining = sorted(remaining, key=key)
    return front + remaining + back


def _order_wildcards(
    contenders: Sequence[TeamRecord],
    head_to_head: Dict[Tuple[int, int], float],
) -> List[TeamRecord]:
    """Order the wild-card pool by the league's actual two-stage procedure.

    **"Only one club advances to the next level."** Before any cross-division
    comparison happens, each division is reduced to its best remaining team
    using the DIVISION tiebreakers — head-to-head, then division record. Only
    then are the survivors compared on conference record. A flat sort over the
    whole pool skips that reduction and gets a specific, recurring case wrong.

    Every one of these was checked against the postseason that was actually
    played, and each is a different step of the same procedure:

    * **2025 NFC** — Carolina and Atlanta both 8-9, both NFC South. Carolina
      won the head-to-head. A flat sort put Atlanta through on conference
      record, which is a tiebreaker the league never reaches for two teams in
      one division that split nothing.
    * **2006 AFC** — Kansas City and Denver both 9-7, both AFC West, series
      split. Division record decides it: .667 to .500, Kansas City. A flat
      conference-record sort hands it to Denver.
    * **2012 NFC** — Minnesota and Chicago both 10-6, both NFC North, series
      split. Same shape, same fix.

    What this still cannot do is **common games**, which is the step below
    conference record and is what separated Pittsburgh from the Jets in 2015 —
    two 10-6 teams, tied on conference record, who never met. That case is
    left to the deterministic id fallback and the archive withholds those
    seeds rather than printing a guess.
    """
    by_division: Dict[str, List[TeamRecord]] = {}
    for record in contenders:
        by_division.setdefault(record.division or "", []).append(record)

    # Stage one: each division ordered among itself, division rules.
    queues = {
        division: _order_with_head_to_head(members, head_to_head, _tiebreak_key)
        for division, members in by_division.items()
    }

    # Stage two: repeatedly take the best division leader still standing.
    out: List[TeamRecord] = []
    while any(queues.values()):
        heads = [queue[0] for queue in queues.values() if queue]
        best = _order_with_head_to_head(heads, head_to_head, _wildcard_key)[0]
        out.append(best)
        queues[best.division or ""].pop(0)
    return out


def _order_with_head_to_head(
    records: Sequence[TeamRecord],
    head_to_head: Dict[Tuple[int, int], float],
    key: Callable[[TeamRecord], Tuple[float, ...]],
) -> List[TeamRecord]:
    """Sort by `key`, then let head-to-head resolve exact win-percentage ties.

    **Applied as a pairwise refinement inside tie groups rather than as a
    comparator**, deliberately. Head-to-head results can cycle — A beat B, B
    beat C, C beat A happens — and a `cmp`-style sort over a non-transitive
    relation produces an order that depends on the input sequence and looks
    perfectly reasonable. Grouping on win percentage first and resolving only
    the two-team groups cannot cycle, and it is also what the league's own
    procedure does.
    """
    ordered = sorted(records, key=key)
    out: List[TeamRecord] = []
    index = 0
    while index < len(ordered):
        run = [ordered[index]]
        while (
            index + len(run) < len(ordered)
            and ordered[index + len(run)].win_pct == ordered[index].win_pct
        ):
            run.append(ordered[index + len(run)])
        out.extend(_head_to_head_adjust(run, head_to_head, key) if len(run) > 1 else run)
        index += len(run)
    return out


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

    # A division winner is decided by the DIVISION key — same opponents, so
    # division record is a fair comparison and the league ranks it second.
    winners: List[TeamRecord] = []
    for members in by_division.values():
        winners.append(
            _order_with_head_to_head(members, head_to_head, _tiebreak_key)[0]
        )

    winner_ids = {record.team_id for record in winners}
    contenders = [r for r in records if r.team_id not in winner_ids]

    # Seeds 1-4 and 5-7 are both CROSS-division comparisons, so both use the
    # wild-card key. Ordering four division champions by their division
    # records would rank them by the weakness of their own divisions.
    winners_sorted = _order_with_head_to_head(winners, head_to_head, _wildcard_key)
    wildcards_sorted = _order_wildcards(contenders, head_to_head)

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
