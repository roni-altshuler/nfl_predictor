export const dynamic = 'force-static'

/**
 * How it works, and — more usefully — what it does not know.
 */
export default function AboutPage() {
  return (
    <div className="max-w-2xl space-y-8">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
          Gridiron
        </p>
        <h1 className="mt-2 text-3xl font-semibold uppercase tracking-[0.1em]">
          How it works
        </h1>
      </header>

      <section className="space-y-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          What it does
        </h2>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          Four things, and nothing else: a win probability and expected margin
          for every game; a season projection covering record, division,
          playoff seed and Super Bowl odds; a comparison against the closing
          line; and a playoff picture. If a proposed feature is none of those,
          it does not belong here.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          The model
        </h2>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          Elo ratings with a margin-of-victory multiplier and an
          autocorrelation correction, feeding a ridge-fitted model of{' '}
          <strong className="text-[var(--text-primary)]">margin</strong> and{' '}
          <strong className="text-[var(--text-primary)]">total</strong>.
          Ratings regress toward the mean between seasons, because the NFL
          drafts in reverse order of finish and caps payrolls.
        </p>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          The margin distribution is <em>not</em> a normal. Football scores
          are built out of 3s and 7s, and the lumpiness is invisible in the
          summary statistics: margin skewness is +0.07 and excess kurtosis is
          +0.20, both of which say &ldquo;normal is an excellent fit&rdquo;.
          Yet 14.8% of games end by exactly three points and only 1.5% end by
          nine. A three-point game is nine times more likely than a nine-point
          game.
        </p>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          So the model multiplies a normal kernel by a measured lattice
          weight. The normal carries location and spread, which do move with
          team strength; the weight carries the arithmetic of scoring, which
          does not. The most telling weight is at zero: a fitted normal
          expects 168 ties in this corpus, and there were 15.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          Why that matters at the number
        </h2>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          When the line is exactly −3, a bet can win, lose{' '}
          <em>or push</em>, and the push is worth roughly one game in twelve.
          Any continuous model assigns a push zero probability by construction
          and silently splits that mass between the two sides — on the most
          heavily traded number in the sport. This one prices all three.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          The standing rules
        </h2>
        <ul className="space-y-2 text-sm leading-relaxed text-[var(--text-secondary)]">
          <li>
            <strong className="text-[var(--text-primary)]">
              The market is the benchmark.
            </strong>{' '}
            Any accuracy claim is a paired comparison against the closing line
            on named games, or it is not made.
          </li>
          <li>
            <strong className="text-[var(--text-primary)]">
              Baselines are never deleted.
            </strong>{' '}
            Elo-only and the constant base rate stay live as yardsticks. A
            model that cannot beat them does not serve.
          </li>
          <li>
            <strong className="text-[var(--text-primary)]">
              No fabricated data.
            </strong>{' '}
            Sparse coverage stays genuinely missing. &ldquo;No line
            published&rdquo; and &ldquo;no edge&rdquo; are different facts and
            render differently.
          </li>
          <li>
            <strong className="text-[var(--text-primary)]">
              If it beats the closing line, suspect the harness first.
            </strong>{' '}
            The model carries no market features. That result is a bug
            announcing itself.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          What it does not know
        </h2>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          <strong className="text-[var(--text-primary)]">
            No injury or roster data.
          </strong>{' '}
          The model does not know who is playing. In a sport where one
          position can be worth several points a game, this is the largest
          single gap, and it is why preseason Super Bowl odds here stay more
          concentrated than a real futures market.
        </p>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          <strong className="text-[var(--text-primary)]">
            No team box-score features.
          </strong>{' '}
          Turnover margin and yardage were built and then removed, because the
          columns behind them are empty for the whole corpus and a constant
          feature makes a model look wider than it is.
        </p>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          <strong className="text-[var(--text-primary)]">
            Tiebreakers are approximated.
          </strong>{' '}
          The league&apos;s procedure runs to twelve steps. Win percentage,
          head-to-head, division and conference record are modelled; anything
          past that breaks deterministically rather than by simulated coin
          toss, because random tiebreaks inside a Monte Carlo add variance
          that looks like uncertainty and is not.
        </p>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          <strong className="text-[var(--text-primary)]">
            The market benchmark is thin before 2012.
          </strong>{' '}
          ESPN kept no odds for the early seasons, and a backfilled line is
          not a closing line — it arrives with no timestamp saying when it was
          current, so it is labelled retrospective and never merged with a
          forward-captured record.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          Not betting advice
        </h2>
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          These are model probabilities published for their own sake. The
          market is better than this model and the accuracy page says so with
          a confidence interval.
        </p>
      </section>
    </div>
  )
}
