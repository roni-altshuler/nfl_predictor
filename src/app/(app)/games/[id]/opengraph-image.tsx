import { ImageResponse } from 'next/og'

import { getGameForecasts } from '@/lib/artifacts'
import { getGameContext, type Meeting } from '@/lib/history'

/**
 * The social card for one game. Ported from the NBA sibling.
 *
 * **Every shared link on this site previewed identically until now** — a
 * conference championship and the ratings page produced the same generic
 * card, which is the single cheapest thing wrong with how this project
 * travels. A card that names the two teams and prints the number is the
 * whole product in one image.
 *
 * Drawn rather than screenshotted, in the site's own tokens: pure black,
 * white letterspaced display, one hairline. **No logos** — NFL marks are
 * authored for light backgrounds and several vanish on black, and a remote
 * image fetched at card-render time is a network dependency inside an image
 * route that has no way to report a failure.
 */

export const runtime = 'nodejs'
export const alt = 'Gridiron game forecast'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const INK = '#f5f5f5'
const MUTED = '#8a8a8a'
const LINE = '#262626'

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const card = describe(id)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#000',
          padding: '64px 72px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              color: INK,
              fontSize: 22,
              letterSpacing: 6,
              textTransform: 'uppercase',
            }}
          >
            Gridiron
          </div>
          <div style={{ color: MUTED, fontSize: 20, letterSpacing: 2 }}>
            {card.eyebrow}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 28,
              color: INK,
              fontSize: 92,
              letterSpacing: 2,
            }}
          >
            <span>{card.away}</span>
            <span style={{ color: MUTED, fontSize: 40 }}>{card.joiner}</span>
            <span>{card.home}</span>
          </div>
          <div style={{ display: 'flex', color: MUTED, fontSize: 30 }}>
            {card.line}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            borderTop: `1px solid ${LINE}`,
            paddingTop: 28,
          }}
        >
          <div style={{ display: 'flex', color: MUTED, fontSize: 22 }}>
            {card.footer}
          </div>
          <div style={{ display: 'flex', color: MUTED, fontSize: 20 }}>
            Scored against the closing line
          </div>
        </div>
      </div>
    ),
    size,
  )
}

interface Card {
  eyebrow: string
  away: string
  home: string
  joiner: string
  line: string
  footer: string
}

function findPlayedGame(id: string): Meeting | null {
  const context = getGameContext()
  if (!context) return null
  for (const meetings of Object.values(context.meetings)) {
    const hit = meetings.find((m) => m.game_id === id)
    if (hit) return hit
  }
  return null
}

/**
 * What the card says, for each kind of game page. A game the site knows
 * nothing about still gets a card rather than a failure: an image route
 * that throws produces a broken preview, which is worse than a plain one.
 */
function describe(id: string): Card {
  const upcoming = getGameForecasts()?.games.find((g) => g.game_id === id)
  if (upcoming) {
    const favourite = upcoming.p_home >= upcoming.p_away ? upcoming.home_name : upcoming.away_name
    const probability = Math.max(upcoming.p_home, upcoming.p_away)
    return {
      eyebrow: `Week ${upcoming.week} · ${upcoming.season}`,
      away: upcoming.away,
      home: upcoming.home,
      joiner: 'at',
      line: `${favourite} ${pct(probability)} · projected ${Math.round(
        upcoming.exp_away_score,
      )}–${Math.round(upcoming.exp_home_score)}`,
      footer: new Date(upcoming.date_utc).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: 'America/New_York',
      }),
    }
  }

  const played = findPlayedGame(id)
  if (played) {
    return {
      eyebrow: played.postseason
        ? `${played.season} · ${played.round ?? 'postseason'}`
        : `${played.season} · Week ${played.week}`,
      away: played.away,
      home: played.home,
      joiner: `${played.away_score} – ${played.home_score}`,
      line:
        played.home_score === played.away_score
          ? 'Finished level — one of football’s rare ties'
          : 'Final',
      footer: played.date,
    }
  }

  return {
    eyebrow: 'Game',
    away: 'NFL',
    home: 'Gridiron',
    joiner: '·',
    line: 'Calibrated NFL game and season forecasting',
    footer: 'gridiron',
  }
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`
}
