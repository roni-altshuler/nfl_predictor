import { ImageResponse } from 'next/og'

import { getPowerRatings, getSeasonProjections } from '@/lib/artifacts'

/**
 * The social card for one franchise — same drawn style as the game card:
 * site tokens, no logos (NFL marks are authored for light backgrounds and
 * a remote fetch inside an image route cannot report a failure). The name,
 * the rating, and the season in three numbers is the whole team page in
 * one image.
 */

export const runtime = 'nodejs'
export const alt = 'Gridiron team forecast'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const INK = '#f5f5f5'
const MUTED = '#8a8a8a'
const LINE = '#262626'
const GREEN = '#5fa657'

export default async function Image({
  params,
}: {
  params: Promise<{ abbr: string }>
}) {
  const { abbr } = await params
  const key = abbr.toUpperCase()

  const ratings = getPowerRatings()
  const index = (ratings?.teams ?? []).findIndex(
    (t) => t.abbreviation.toUpperCase() === key,
  )
  const team = index >= 0 ? ratings!.teams[index] : null
  const projection = team
    ? getSeasonProjections()?.teams.find((t) => t.team_id === team.team_id)
    : null

  const stats: Array<[string, string]> = team
    ? [
        ['Elo', team.elo.toFixed(0)],
        ['Rank', `#${index + 1} of ${ratings!.teams.length}`],
        ...(projection
          ? ([
              [
                'Projected',
                `${projection.wins.toFixed(1)}-${projection.losses.toFixed(1)}`,
              ],
              ['Playoffs', `${(projection.p_playoffs * 100).toFixed(0)}%`],
            ] as Array<[string, string]>)
          : []),
      ]
    : []

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
            {team?.division ?? 'Team'}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', color: GREEN, fontSize: 40, letterSpacing: 4 }}>
            {key}
          </div>
          <div style={{ display: 'flex', color: INK, fontSize: 84, letterSpacing: 1 }}>
            {team?.name ?? 'Gridiron'}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 56,
            borderTop: `1px solid ${LINE}`,
            paddingTop: 28,
          }}
        >
          {stats.length ? (
            stats.map(([label, value]) => (
              <div
                key={label}
                style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
              >
                <div
                  style={{
                    color: MUTED,
                    fontSize: 18,
                    letterSpacing: 3,
                    textTransform: 'uppercase',
                  }}
                >
                  {label}
                </div>
                <div style={{ color: INK, fontSize: 34 }}>{value}</div>
              </div>
            ))
          ) : (
            <div style={{ color: MUTED, fontSize: 24 }}>
              Calibrated NFL forecasting
            </div>
          )}
        </div>
      </div>
    ),
    size,
  )
}
