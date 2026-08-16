import { getMarketBenchmark, getSeasonProjections } from '@/lib/artifacts'
import { pct, signed, stamp } from '@/lib/format'

export const dynamic = 'force-static'

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

      <p className="font-mono text-[10px] leading-relaxed text-[var(--text-tertiary)]">
        A Brier from this project is binary, over two outcomes, on NFL games.
        It is not comparable to one from the sibling soccer project
        (multiclass over three outcomes) or from the NBA one (a different
        sport with a different base rate). Never put them in one table.
      </p>
    </div>
  )
}
