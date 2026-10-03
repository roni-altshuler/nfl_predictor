# Week and game browsing — October 2026

`/games` now opens a single published NFL week. Readers can choose an available
week, team or their existing local watchlist; the season selector distinguishes
published forecasts from recorded-results archives. Day groups and kickoff
times use Eastern time. `?week=4&team=IND&following=1` restores filters, including
browser Back. Empty filters offer a keyboard-accessible reset.

Game cards show full team names, win/tie probabilities, expected total and the
published market line, preserving the neutral-site flag. Remote marks fall back
to abbreviations while loading or after failure. Game detail adds the full
matchup, forecast publication time, results cutoff and section navigation. Its
existing margin lattice, spread slider, market, availability and recent meetings
remain connected to their original data. Section navigation moves focus without
adding a separate Back step. A missing injury response explicitly stays unknown.

The green field, typography, shared navigation and existing forecast calculations
remain the product's identity. The week hierarchy takes its reference from the
[official NFL schedule](https://www.nfl.com/schedules/).

## Verification

- Existing forecast-lab regression checks and new week/date assertions passed.
  The latter cover invalid week parameters, Eastern day boundaries, daylight
  saving time, ordering, empty data and input preservation.
- Repository lint and TypeScript passed. The production build completed all 321
  routes locally with two build workers and ESPN requests deliberately blocked.
- Headless Edge exercised the **production server** at 390, 768 and 1440 px:
  team/week URL changes, keyboard game links, section focus, the real spread
  slider, Back restoration, watchlist-empty recovery and no horizontal overflow.
  The season selector rendered the 2025 recorded-results page at 390 px.
- A separate production-browser check blocked ESPN/CDN requests and verified
  both the unavailable-availability panel and team abbreviation fallback.
  All audited flows had zero uncaught browser exceptions.
- Full-page slate and game screenshots were visually inspected at all three
  widths. Representative captures are below.

The published artifact inspected here was generated **2026-10-02T16:33:42Z**:
223 remaining fixtures across weeks 4–18. Week 4 contained 15 games. No fixtures
or probabilities were regenerated. The normal development-server check displayed
a successful ESPN injury response for Indianapolis–Washington; the production
outage check intentionally verifies the missing-response branch. Active-game
polling, every archived season and mobile screen-reader operation were not
tested. Local backend tests were not repeated for this frontend change; CI is
the broader gate. This work does not establish a model-quality improvement or
verify historical market timestamps as closes.

![Published week on mobile](screenshots/week-mobile.png)
![Published week on desktop](screenshots/week-desktop.png)
![Game detail on mobile](screenshots/game-mobile.png)
![Unavailable availability report](screenshots/availability-unavailable.png)
