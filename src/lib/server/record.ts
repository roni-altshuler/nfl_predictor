/** Server-only artifact I/O; the pure derivation never reads or mutates files. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { buildSeasonRecord, type SeasonRecord } from '../record'

export function loadSeasonRecord(options: { dataDirectory?: string; season?: number } = {}): SeasonRecord {
  const directory = options.dataDirectory ?? path.join(process.cwd(), 'backend', 'data')
  const hashes: Record<string, string | null> = {}
  function read(name: string, relative: string): unknown {
    try { const raw = fs.readFileSync(path.join(directory, relative)); hashes[name] = createHash('sha256').update(raw).digest('hex'); return JSON.parse(raw.toString('utf8')) }
    catch { hashes[name] ??= null; return null }
  }
  const first = read('first', 'predictions/forecast_log.json'), comparison = read('comparison', 'predictions/forecast_comparison.json'), current = read('current', 'predictions/game_forecasts.json')
  const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const candidate = options.season ?? obj(current).season ?? obj(first).season
  const season = typeof candidate === 'number' && Number.isSafeInteger(candidate) ? candidate : undefined
  const history = season === undefined ? null : read('history', `history/season_${season}.json`)
  hashes.history ??= null
  const expected = obj(obj(comparison).sources).first_sha256
  return buildSeasonRecord({ season, first, comparison, current, history, firstHashVerified: typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected) && hashes.first === expected, sourceHashes: hashes })
}
