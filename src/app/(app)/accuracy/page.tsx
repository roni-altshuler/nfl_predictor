import { CalibrationChart } from '@/components/charts/CalibrationChart'
import { PitHistogram } from '@/components/charts/PitHistogram'
import { SeasonBrierChart } from '@/components/charts/SeasonBrierChart'
import {
  getMarketBenchmark,
  getSeasonProjections,
  type ContinuousBlock,
} from '@/lib/artifacts'
import { pct, signed, stamp } from '@/lib/format'

export const dynamic = 'force-static'

export const metadata = { title: 'Accuracy' }

const LABELS: Record<string, string> = {
  market: 'Market (closing line)',
  margin_model: 'Margin model',
  elo_only: 'Elo only',
  constant_base_rate: 'Constant base rate',
}

// Ordered worst-expected to best so the market sits at the top as the
// benchmark rather than as one row among four.
const ORDER = ['market', 'margin_model', 'elo_only', 'constant_base_rate']

/**
 * The record.
 *
 * **This page exists to report the model's limits, not to sell it.** Three
 * rules from the sibling projects apply verbatim: the market is the
 * benchmark, baselines are never deleted, and a claim is stated as a paired
 * comparison on named games or it is not stated.
 */
export default function AccuracyPage() {
  const benchmark = getMarketBenchmark()
  const projections = getSeasonProjections()
  const live = (projections?.games_played ?? 0) > 0

  if (!benchmark) {
    return (
      <p className="font-mono text-sm text-[var(--text-tertiary)]">
        No benchmark published.
      </p>
    )
  }

  const cards = ORDER.filter((key) => benchmark.scorecards[key]).map((key) => ({
    key,
    label: LABELS[key] ?? key,
    ...benchmark.scorecards[key],
  }))

  const model = benchmark.paired_vs_market?.margin_model

  // Read off the artifact rather than hardcoded, so the note disappears by
  // itself the day the feature layer starts earning its place.
  const elo = benchmark.scorecards.elo_only
  const margin = benchmark.scorecards.margin_model
  const eloBeatsModel =
    !!elo && !!margin && (elo.brier <= margin.brier || elo.ece < margin.ece)

  return (
    <div className="space-y-8">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
          walk-forward, {benchmark.refit_cadence}
        </p>
        <h1 className="mt-2 text-3xl font-semibold uppercase tracking-[0.1em]">
          Accuracy
        </h1>
        <p className="mt-2 font-mono text-[11px] text-[var(--text-tertiary)]">
          {benchmark.scored_games.toLocaleString()} games scored from{' '}
          {benchmark.first_scored_season} · {benchmark.warmup_seasons}-season
          warm-up · de-vig {benchmark.devig_method} · published{' '}
          {stamp(benchmark.generated_at)}
        </p>
      </header>

      {!live ? (
        <p className="rounded-[var(--radius)] border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-3 font-mono text-[11px] leading-relaxed text-[var(--accent-warn)]">
          <strong className="font-semibold">
            There is no live record yet.
          </strong>{' '}
          The season has not kicked off. Everything below is a historical
          walk-forward — the model refit on games strictly earlier than each
          week it scores, so it never saw the game it is being graded on. But
          nobody read these numbers before those kickoffs either. The live
          record will start at zero and be reported at whatever n it reaches,
          never merged with this.
        </p>
      ) : null}

      {/* ------------------------------------------------------ scorecards */}
      <section>
        <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          Scored on decided games
        </h2>
        <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border-color)] bg-[var(--card-bg)]">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="border-b border-[var(--border-color)] text-left">
                {['forecaster', 'brier', 'log loss', 'accuracy', 'ece', 'n'].map(
                  (label) => (
                    <th
                      key={label}
                      className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]"
                    >
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {cards.map((card) => (
                <tr
                  key={card.key}
                  className="border-b border-[var(--border-color)] last:border-0"
                >
                  <td
                    className={
                      card.key === 'market'
                        ? 'px-3 py-2.5 text-sm text-[var(--accent-market)]'
                        : 'px-3 py-2.5 text-sm text-[var(--text-secondary)]'
                    }
                  >
                    {card.label}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-sm text-[var(--text-primary)]">
                    {card.brier.toFixed(4)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-secondary)]">
                    {card.log_loss.toFixed(4)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-secondary)]">
                    {pct(card.accuracy, 1)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-secondary)]">
                    {card.ece.toFixed(4)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--text-tertiary)]">
                    {card.n.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
          Ties are excluded from every figure above and counted separately —{' '}
          {cards[0]?.ties_excluded ?? 0} of them in the market&apos;s sample. A
          moneyline voids on a tie, so the model&apos;s three-outcome forecast
          is conditioned on the game being decided before it meets one.
        </p>

        {eloBeatsModel ? (
          <p className="mt-3 rounded-[var(--radius)] border border-[var(--border-color)] bg-[var(--background-tertiary)] px-4 py-3 font-mono text-[11px] leading-relaxed text-[var(--accent-warn)]">
            <strong className="font-semibold">
              The margin model does not currently beat Elo alone.
            </strong>{' '}
            It is level on Brier and worse calibrated. Nine features have
            bought nothing over a rating gap and a home-field constant — Elo
            already encodes team strength, and rest, division and form are
            either small or already priced into the rating. The feature layer
            has not earned its place yet, and this page is not going to imply
            otherwise. Elo-only stays live as the yardstick.
          </p>
        ) : null}
      </section>

      {/* ---------------------------------------------- paired comparison */}
      {model ? (
        <section>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Paired against the closing line
          </h2>
          <div className="rounded-[var(--radius)] border border-[var(--border-color)] bg-[var(--card-bg)] p-4">
            <p className="font-mono text-sm text-[var(--text-secondary)]">
              Brier gap{' '}
              <span className="text-[var(--text-primary)]">
                {signed(model.mean, 5)}
              </span>{' '}
              · 95% CI [{signed(model.lo, 5)}, {signed(model.hi, 5)}]
            </p>
            <p className="mt-2 font-mono text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              {benchmark.priced_games.toLocaleString()} priced games;{' '}
              {benchmark.unpriced_games.toLocaleString()} unpriced and excluded
              rather than compared against nothing. Market probabilities come
              from{' '}
              {Object.entries(benchmark.market_source_counts)
                .map(([source, n]) => `${n.toLocaleString()} ${source}`)
                .join(' and ')}
              .
            </p>
            {model.mean < 0 ? (
              <p className="mt-3 font-mono text-[11px] leading-relaxed text-[var(--accent-loss)]">
                The model is ahead of the closing line on this sample. It
                carries no market features, so that result should be read as a
                warning about the harness or the sample rather than as an
                edge — see the note below.
              </p>
            ) : (
              <p className="mt-3 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
                The market is better. That is the expected and wanted result:
                the model carries no market features, and a forecaster with no
                price information that beat the price would be a bug
                announcing itself.
              </p>
            )}
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------ calibration */}
      {benchmark.reliability?.margin_model?.length ? (
        <section>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Calibration
          </h2>
          <p className="mb-3 max-w-2xl font-mono text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            Accuracy is a fact about the schedule as much as about the model —
            a season of blowouts is easy to call. Calibration is a fact about
            the model alone, and it is the property this product is actually
            selling.
          </p>
          <div className="card p-4">
            <CalibrationChart
              series={[
                {
                  key: 'model',
                  label: 'Margin model',
                  color: 'var(--viz-model)',
                  shape: 'circle',
                  buckets: benchmark.reliability.margin_model,
                },
                {
                  key: 'market',
                  label: 'Closing line',
                  color: 'var(--viz-market)',
                  shape: 'square',
                  buckets: benchmark.reliability.market ?? [],
                },
              ]}
              caption="Dot area is the number of games in the bucket. Above the dashed line means it was too cautious; below it, too confident. The two are drawn on different game sets — the market only exists where a line was published — so read each against the diagonal rather than against the other."
            />
          </div>
        </section>
      ) : null}

      {/* -------------------------------------------------------- by season */}
      {benchmark.by_season && Object.keys(benchmark.by_season).length > 2 ? (
        <section>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Season by season
          </h2>
          <div className="card p-4">
            <SeasonBrierChart bySeason={benchmark.by_season} />
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------- continuous */}
      {benchmark.continuous ? (
        <section>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Margin and total
          </h2>
          <p className="mb-3 max-w-2xl font-mono text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            Every game card publishes an expected margin and an expected total.
            Until these were measured, neither was scored anywhere — which the
            standing rule does not permit.
          </p>

          <div className="grid gap-4 xl:grid-cols-2">
            <ContinuousCard
              title="Margin"
              block={benchmark.continuous.margin}
              marketLabel="the spread"
              unit="points"
            />
            <ContinuousCard
              title="Total"
              block={benchmark.continuous.total}
              marketLabel="the posted total"
              unit="points"
            />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div className="card p-4">
              <h3 className="eyebrow mb-3">Margin distribution shape</h3>
              <PitHistogram pit={benchmark.continuous.margin.pit} label="margin" />
            </div>
            <div className="card p-4">
              <h3 className="eyebrow mb-3">Total distribution shape</h3>
              <PitHistogram pit={benchmark.continuous.total.pit} label="total" />
            </div>
          </div>

          <p className="mt-3 max-w-3xl font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
            {benchmark.continuous.note}
          </p>
        </section>
      ) : null}

      <p className="font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        A Brier from this project is binary, over two outcomes, on NFL games.
        It is not comparable to one from the sibling soccer project
        (multiclass over three outcomes) or from the NBA one (a different
        sport with a different base rate). Never put them in one table.
      </p>
    </div>
  )
}

/**
 * One continuous quantity: how far off, which direction, and whether the
 * published interval holds.
 *
 * **The coverage rows are the ones with consequences beyond their own table.**
 * The win probability is not fitted separately — it is the mass of the same
 * margin lattice above zero, and every cover probability and playoff price is
 * a sum over it too. A distribution that is too narrow makes every percentage
 * on this site overconfident by an amount the moneyline ECE only partly shows.
 */
function ContinuousCard({
  title,
  block,
  marketLabel,
  unit,
}: {
  title: string
  block: ContinuousBlock
  marketLabel: string
  unit: string
}) {
  const gap = block.vs_market?.mae_gap
  return (
    <div className="card p-4">
      <h3 className="eyebrow mb-3">{title}</h3>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Mean abs. error" value={`${block.model.mae?.toFixed(2) ?? '—'}`} />
        <Stat
          label="Bias"
          value={block.model.bias != null ? signed(block.model.bias, 2) : '—'}
        />
        <Stat
          label={`vs ${marketLabel}`}
          value={
            block.vs_market?.market_mae != null
              ? block.vs_market.market_mae.toFixed(2)
              : '—'
          }
        />
        <Stat
          label="Gap"
          value={gap != null ? signed(gap, 2) : '—'}
          tone={gap != null && gap > 0 ? 'warn' : undefined}
        />
      </dl>

      <table className="mt-4">
        <thead>
          <tr>
            <th scope="col">Interval</th>
            <th scope="col" className="numeric text-right">Nominal</th>
            <th scope="col" className="numeric text-right">Actual</th>
            <th scope="col" className="numeric text-right">Gap</th>
          </tr>
        </thead>
        <tbody>
          {block.coverage.map((row) => (
            <tr key={row.nominal}>
              <td className="numeric text-[var(--text-tertiary)]">
                central {Math.round(row.nominal * 100)}%
              </td>
              <td className="numeric text-right text-[var(--text-tertiary)]">
                {pct(row.nominal, 0)}
              </td>
              <td className="numeric text-right text-[var(--text-primary)]">
                {pct(row.coverage, 1)}
              </td>
              <td
                className={
                  Math.abs(row.gap) > 0.03
                    ? 'numeric text-right text-[var(--accent-warn)]'
                    : 'numeric text-right text-[var(--text-secondary)]'
                }
              >
                {signed(row.gap * 100, 1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        Errors are in {unit}. {title === 'Margin' ? (
          <>
            The margin interval is read off the LATTICE, which is discrete, so
            it is the smallest range of whole point margins whose mass reaches
            the nominal level. That is conservative by construction — over-
            coverage at the 50% level is mostly the fat cells at 3 and 7 points,
            not a miscalibration.
          </>
        ) : (
          <>The total is served as a normal and is measured as one.</>
        )}
      </p>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'warn'
}) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd
        className={
          tone === 'warn'
            ? 'numeric mt-1 text-sm text-[var(--accent-warn)]'
            : 'numeric mt-1 text-sm text-[var(--text-primary)]'
        }
      >
        {value}
      </dd>
    </div>
  )
}
