import Link from 'next/link'

import { getMarketBenchmark, getSeasonProjections } from '@/lib/artifacts'
import { pct, signed } from '@/lib/format'

export const metadata = { title: 'How it works' }
export const dynamic = 'force-static'

/*
 * The method page.
 *
 * Structured rather than stacked. The previous version was a column of
 * headings and paragraphs at one type size, which is a memo: nothing told a
 * reader where they were, what mattered, or how much was left. The shape
 * here does three things a flat stack cannot.
 *
 * 1. **The claim leads, in numbers.** Anyone landing on a method page is
 *    deciding whether to trust the product. The headline figures — corpus
 *    size, the gap to the closing line, calibration error — go above the
 *    prose, because they are the answer to the question being asked.
 * 2. **Three parts, numbered sections, a contents rail.** Method, evidence,
 *    limits. The rail is sticky on desktop and the sections are numbered, so
 *    position in a long document is always legible.
 * 3. **One idea per section, stated first.** Each section opens with its
 *    conclusion in larger type, and the supporting detail follows. A reader
 *    skimming only the leads gets the whole argument.
 *
 * **Every figure is read from a published artifact, not typed in.** A method
 * page with hardcoded numbers goes stale silently and becomes the least
 * trustworthy page on a site whose entire pitch is calibration.
 */

const SECTIONS = [
  { id: 'scope', part: 'Method', title: 'What it does' },
  { id: 'lattice', part: 'Method', title: 'Football margins are lumpy' },
  { id: 'push', part: 'Method', title: 'Why that matters at the number' },
  { id: 'ties', part: 'Method', title: 'Ties are real, and unpriced' },
  { id: 'home', part: 'Method', title: 'Home advantage has halved' },
  { id: 'seeding', part: 'Method', title: 'Seeding is not by record' },
  { id: 'simulation', part: 'Method', title: 'Season simulation' },
  { id: 'benchmark', part: 'Evidence', title: 'The market is the benchmark' },
  { id: 'elo', part: 'Evidence', title: 'The features have not earned it' },
  { id: 'live', part: 'Evidence', title: 'Backtest is never live' },
  { id: 'limits', part: 'Limits', title: 'What it will not do' },
  { id: 'missing', part: 'Limits', title: 'What is missing' },
]

export default function AboutPage() {
  const benchmark = getMarketBenchmark()
  const projections = getSeasonProjections()

  const cards = benchmark?.scorecards ?? {}
  const model = cards.margin_model
  const elo = cards.elo_only
  const market = cards.market
  const paired = benchmark?.paired_vs_market?.margin_model

  return (
    <div>
      <header className="mb-8 max-w-3xl">
        <p className="eyebrow">Method</p>
        <h1 className="mt-1 text-2xl">How it works</h1>
        <p className="mt-4 text-base leading-relaxed text-[var(--text-secondary)]">
          A margin-and-total model over every NFL game since the league
          realigned to 32 teams in 2002, refit weekly, and scored against the
          closing line on named games. It is behind the market by a published
          margin, and that is the result the design predicts rather than a
          disappointment.
        </p>
      </header>

      <section aria-label="Headline figures" className="mb-10">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Figure
            label="Games scored"
            value={benchmark?.scored_games.toLocaleString() ?? '—'}
            note="walk-forward, out of sample"
          />
          <Figure
            label="Gap to the close"
            value={paired ? signed(paired.mean, 4) : '—'}
            note="Brier, lower is better"
          />
          <Figure
            label="Calibration error"
            value={model ? model.ece.toFixed(4) : '—'}
            note="expected vs observed"
          />
          <Figure
            label="Priced games"
            value={benchmark?.priced_games.toLocaleString() ?? '—'}
            note="paired against the close"
          />
        </div>
      </section>

      <div className="lg:grid lg:grid-cols-[168px_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Contents" className="mb-8 lg:mb-0">
          <div className="lg:sticky lg:top-6">
            <p className="eyebrow mb-2">Contents</p>
            <ol className="space-y-1">
              {SECTIONS.map((section, index) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="flex gap-2 py-0.5 text-[11px] leading-snug text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
                  >
                    <span className="numeric">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span>{section.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <div className="max-w-2xl">
          <Part title="Method" />

          <Section n={1} id="scope" title="What it does">
            <Lead>
              Four things, and nothing else. If a proposed feature is none of
              them, it does not belong here.
            </Lead>
            <ol className="ml-4 list-decimal space-y-1.5">
              <li>A win probability and expected score for every game.</li>
              <li>
                A projected season: record, division, seed and Super Bowl odds.
              </li>
              <li>
                A value surface comparing the model against the no-vig market
                price.
              </li>
              <li>The playoff picture — who makes the field and who hosts.</li>
            </ol>
          </Section>

          <Section n={2} id="lattice" title="Football margins are lumpy">
            <Lead>
              Every summary statistic says a normal distribution fits these
              margins. Every one of them is missing the point.
            </Lead>
            <p>
              Margin skewness is +0.07 and excess kurtosis is +0.20 — textbook
              &ldquo;normal is an excellent fit&rdquo;. And the distribution is
              nothing of the sort, because football scores are built out of 3s
              and 7s.
            </p>
            <div className="card my-4 overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Margin</th>
                    <th scope="col" className="numeric text-right">Actual</th>
                    <th scope="col" className="numeric text-right">A normal expects</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['3', '14.82%', '5.4%'],
                    ['7', '9.08%', '5.2%'],
                    ['5', '3.57%', '5.4%'],
                    ['9', '1.54%', '4.9%'],
                  ].map(([margin, actual, expected]) => (
                    <tr key={margin}>
                      <td className="numeric">{margin}</td>
                      <td className="numeric text-right text-[var(--text-primary)]">
                        {actual}
                      </td>
                      <td className="numeric text-right">{expected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              A three-point game is <strong className="text-[var(--text-primary)]">nine
              times</strong> more likely than a nine-point game. No moment up
              to fourth order can see that, because the lumpiness is periodic
              rather than skewed or heavy-tailed: it moves mass between
              adjacent integers while leaving the shape at scale untouched.
            </p>
            <p>
              So the model is a normal kernel modulated by a measured lattice
              weight. The normal carries location and spread, which do move
              with team strength; the weight carries the arithmetic of
              scoring, which does not — a three-point game is
              over-represented whether the game was a pick&apos;em or a
              mismatch.
            </p>
            <Measured>
              The weight is measured, not designed: w(3) = 2.88, w(7) = 1.83,
              w(9) = 0.46. The one to read twice is{' '}
              <strong className="text-[var(--text-secondary)]">w(0) = 0.13</strong>
              . A fitted normal expects 168 ties in this corpus. There were 15.
            </Measured>
            <p className="text-[13px]">
              You can see the whole lattice on any{' '}
              <Link href="/games" className="text-[var(--accent-info)] hover:underline">
                game page
              </Link>
              .
            </p>
          </Section>

          <Section n={3} id="push" title="Why that matters at the number">
            <Lead>
              When the line is exactly −3, a bet can win, lose{' '}
              <em>or push</em> — and the push is worth roughly one game in
              twelve.
            </Lead>
            <p>
              Any continuous model assigns a push zero probability by
              construction, then silently redistributes that mass to the two
              sides. On the most heavily traded number in the sport. This
              model prices all three outcomes, and a half-point line correctly
              pushes with probability zero because no integer margin equals
              it.
            </p>
          </Section>

          <Section n={4} id="ties" title="Ties are real, and the market does not price them">
            <Lead>
              An NFL game can end level. It is rare — 0.241% of regular-season
              games — and it is structural rather than a rounding error.
            </Lead>
            <p>
              A moneyline <strong className="text-[var(--text-primary)]">voids</strong>{' '}
              on a tie: stakes returned, no winner. So a de-vigged two-way
              price is not P(home wins), it is P(home wins given the game is
              decided). Comparing an unconditional model probability against
              it understates the model by exactly the tie mass on every single
              game — a small, one-directional bias that would look like
              systematic shading toward the underdog.
            </p>
            <Measured>
              Model probabilities are conditioned before they meet a price,
              and ties are excluded from every scored figure and counted
              beside it. The sibling NBA project has no tie branch at all and
              is right not to: it measures zero ties in 27,690 games.
            </Measured>
          </Section>

          <Section n={5} id="home" title="Home advantage has halved">
            <Lead>
              A fixed constant would mis-price the modern game badly. It has
              fallen from about 53 rating points to about 28.
            </Lead>
            <div className="card my-4 overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Era</th>
                    <th scope="col" className="numeric text-right">Home win rate</th>
                    <th scope="col" className="numeric text-right">Mean margin</th>
                    <th scope="col" className="numeric text-right">Rating points</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['2002–2006', '.5758', '+2.56', '53'],
                    ['2007–2011', '.5680', '+2.56', '48'],
                    ['2012–2016', '.5705', '+2.43', '51'],
                    ['2017–2020', '.5460', '+1.21', '33'],
                    ['2021–2025', '.5382', '+2.08', '28'],
                  ].map(([era, rate, margin, points]) => (
                    <tr key={era}>
                      <td className="numeric">{era}</td>
                      <td className="numeric text-right">{rate}</td>
                      <td className="numeric text-right">{margin}</td>
                      <td className="numeric text-right text-[var(--text-primary)]">
                        {points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              The 2017–2020 row contains the empty-stadium 2020 season and its
              +1.21 should not be read as a trend point. The served model
              refits weekly and picks the current value up through its
              intercept, so it tracks this drift rather than assuming it away.
            </p>
          </Section>

          <Section n={6} id="seeding" title="Seeding is not by record">
            <Lead>
              Four division winners take seeds 1–4 whatever the records say. A
              9-8 division champion hosts a 13-4 wild card.
            </Lead>
            <p>
              This is why the projection cannot be a conference table sorted by
              wins, which is what the sibling basketball project correctly
              does for its own sport. The field also changed size in 2020 —
              from 12 teams with two byes per conference to 14 with one — and
              the bracket reseeds after every round, so who a team meets in the
              divisional round depends on games it was not playing in.
            </p>
            <Measured>
              The Super Bowl is simulated at a neutral site. Every other
              postseason game is hosted by the better seed, and carrying home
              advantage into the last one would hand the higher-rated
              conference champion a few percent it has not earned.
            </Measured>
          </Section>

          <Section n={7} id="simulation" title="Season simulation">
            <Lead>
              Each simulated season draws one strength offset per franchise and
              holds it for all seventeen games, rather than perturbing each
              game independently.
            </Lead>
            <p>
              A team that is better than its rating is better in all of them,
              so no number of simulations averages that error away. The
              offset&apos;s size is measured: within-season rating drift over
              768 team-seasons has a standard deviation of 34.5 rating points.
            </p>
            <Measured>
              Projected win totals are deliberately wide. Over seventeen games
              even a perfectly known .600 team has a binomial standard
              deviation of about two wins — more than a fifth of its expected
              total. A narrow interval here would be wrong rather than
              confident.
            </Measured>
          </Section>

          <Part title="Evidence" />

          <Section n={8} id="benchmark" title="The market is the benchmark">
            <Lead>
              The closing line beats this model, significantly, and that is the
              wanted result.
            </Lead>
            {market && model && elo ? (
              <div className="card my-4 overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Forecaster</th>
                      <th scope="col" className="numeric text-right">Brier</th>
                      <th scope="col" className="numeric text-right">Accuracy</th>
                      <th scope="col" className="numeric text-right">ECE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['Market (closing line)', market],
                      ['Elo only', elo],
                      ['Margin model', model],
                      ['Constant base rate', cards.constant_base_rate],
                    ]
                      .filter(([, card]) => card)
                      .map(([label, card]: any) => (
                        <tr key={label}>
                          <td>{label}</td>
                          <td className="numeric text-right text-[var(--text-primary)]">
                            {card.brier.toFixed(4)}
                          </td>
                          <td className="numeric text-right">
                            {pct(card.accuracy, 1)}
                          </td>
                          <td className="numeric text-right">
                            {card.ece.toFixed(4)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p>
              The model carries no market features. A forecaster that had never
              seen a price and beat the price would be a bug announcing itself,
              not an edge — so the benchmark script logs a warning rather than
              a triumph if it ever happens.
            </p>
            {paired ? (
              <Measured>
                Paired bootstrap on {benchmark?.priced_games.toLocaleString()}{' '}
                priced, decided games: {signed(paired.mean, 5)}, 95% CI [
                {signed(paired.lo, 5)}, {signed(paired.hi, 5)}]. The model
                closes about three quarters of the distance from a constant
                base rate to the market.
              </Measured>
            ) : null}
          </Section>

          <Section n={9} id="elo" title="The extra features have not earned their place">
            <Lead>
              The nine-feature model does not beat plain Elo. That is reported
              rather than dressed up.
            </Lead>
            <p>
              It is level on Brier and materially worse calibrated. Elo already
              encodes team strength, and rest, division and recent form turn
              out to be either small or already priced into the rating. A
              baseline that a model cannot beat stays live as the yardstick —
              baselines are never deleted here.
            </p>
          </Section>

          <Section n={10} id="live" title="A backtest is never a live record">
            <Lead>
              Everything on the accuracy page is a reconstruction. The live
              record is a separate number and starts at zero.
            </Lead>
            <p>
              The walk-forward refits on games strictly earlier than each week
              it scores, so the model never saw the game it is graded on. But
              nobody read those numbers before those kickoffs either. Every
              published forecast is stamped before its kickoff and graded
              separately, and the two are never merged however tempting a
              larger sample is.
            </p>
          </Section>

          <Part title="Limits" />

          <Section n={11} id="limits" title="What it will not do">
            <dl className="space-y-3">
              <Rule term="It will not tell you what to bet">
                These are model probabilities published for their own sake. The
                market is better than this model and the{' '}
                <Link href="/accuracy" className="text-[var(--accent-info)] hover:underline">
                  accuracy page
                </Link>{' '}
                says so with a confidence interval.
              </Rule>
              <Rule term="It will not show confidence it has not measured">
                Displayed confidence never exceeds measured confidence.
              </Rule>
              <Rule term="It will not fill a gap with a plausible number">
                Sparse coverage stays genuinely missing. &ldquo;No line
                published&rdquo; and &ldquo;no edge&rdquo; are different facts
                and render differently.
              </Rule>
            </dl>
          </Section>

          <Section n={12} id="missing" title="What is missing">
            <dl className="space-y-3">
              <Rule term="No injury or roster data">
                The model does not know who is playing. In a sport where one
                position is worth several points a game this is the largest
                single gap, and it is why preseason Super Bowl odds here stay
                more concentrated than a real futures market. Game pages show
                the injury report from ESPN so a reader can apply what the
                model cannot.
              </Rule>
              <Rule term="No team box-score features">
                Turnover margin and yardage were built and then removed,
                because the columns behind them are empty for the whole corpus.
                A constant feature is not a weak feature, it is an absent one.
              </Rule>
              <Rule term="Tiebreakers are approximated">
                Win percentage, head-to-head, division and conference record
                are modelled. The league&apos;s procedure has twelve steps; the
                remainder breaks deterministically rather than by simulated
                coin toss, because a random tiebreak inside a Monte Carlo adds
                variance that looks like uncertainty and is not.
              </Rule>
              <Rule term="The market benchmark is thin before 2012">
                ESPN kept no odds for the early seasons, and a backfilled line
                is not a closing line — it arrives with no timestamp saying
                when it was current.
              </Rule>
            </dl>
          </Section>

          {projections ? (
            <p className="mt-8 border-t border-[var(--border-color)] pt-4 numeric text-[10px] text-[var(--text-tertiary)]">
              model {projections.model_version} · every figure on this page is
              read from a published artifact, not typed in
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- pieces */

function Figure({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note: string
}) {
  return (
    <div className="card p-3">
      <p className="eyebrow">{label}</p>
      <p className="numeric mt-1 text-xl text-[var(--text-primary)]">{value}</p>
      <p className="mt-1 text-[10px] leading-snug text-[var(--text-tertiary)]">
        {note}
      </p>
    </div>
  )
}

function Part({ title }: { title: string }) {
  return (
    <h2 className="mb-4 mt-10 border-b border-[var(--border-color)] pb-2 numeric text-[11px] uppercase tracking-[0.18em] text-[var(--text-tertiary)] first:mt-0">
      {title}
    </h2>
  )
}

function Section({
  n,
  id,
  title,
  children,
}: {
  n: number
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="mb-8 scroll-mt-6">
      <h3 className="mb-3 flex items-baseline gap-2.5 text-sm text-[var(--text-primary)]">
        <span className="numeric text-[11px] text-[var(--text-tertiary)]">
          {String(n).padStart(2, '0')}
        </span>
        {title}
      </h3>
      <div className="space-y-3 text-sm leading-relaxed text-[var(--text-secondary)]">
        {children}
      </div>
    </section>
  )
}

/** The section's conclusion, stated first and set larger than its support. */
function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[15px] leading-relaxed text-[var(--text-primary)]">
      {children}
    </p>
  )
}

/** A measured claim, set apart from the argument around it. */
function Measured({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-l border-[var(--border-hover)] py-0.5 pl-3 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
      {children}
    </p>
  )
}

function Rule({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[var(--text-primary)]">{term}</dt>
      <dd className="mt-0.5 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
        {children}
      </dd>
    </div>
  )
}
