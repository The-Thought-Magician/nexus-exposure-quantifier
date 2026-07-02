import Link from 'next/link'

const features = [
  {
    title: 'Retroactive crossing-date determination',
    body: 'The engine reviews historical sales chronologically, by state, and establishes the precise month each economic-nexus threshold was first triggered, applying rolling-12-month or calendar-year windows and dual sales/transaction tests as governed by each jurisdiction’s rule.',
  },
  {
    title: 'Per-state uncollected-tax computation',
    body: 'From the determined crossing date forward to the stated as-of date, the applicable state effective rate is applied to taxable sales, period by period, aligned to the jurisdiction’s filing frequency, yielding a documented base-tax subtotal.',
  },
  {
    title: 'Penalty and interest accrual',
    body: 'Each jurisdiction’s failure-to-file and failure-to-pay penalty schedule, applicable caps and minimums, and statutory interest convention are applied and accrued through the current date.',
  },
  {
    title: 'Voluntary Disclosure Agreement modeling',
    body: 'Recomputes total exposure under a Voluntary Disclosure Agreement, applying the capped lookback window and penalty abatement, and quantifies the resulting reduction in liability relative to no remediation.',
  },
  {
    title: 'Register, disclose, or defer: comparative analysis',
    body: 'Presents the three remediation paths side by side, each with a total liability figure and per-state detail, to support a documented, materiality-based remediation decision.',
  },
  {
    title: 'Exposure memoranda for the record',
    body: 'Produces per-state and consolidated memoranda documenting methodology, assumptions, and citations, each stamped with the as-of date, suitable for inclusion in a diligence data room.',
  },
  {
    title: 'Materiality ranking',
    body: 'Ranks jurisdictions by exposure using configurable high, medium, and low thresholds to identify which states account for the majority of the liability under review.',
  },
  {
    title: 'Cost-of-delay projection',
    body: 'Projects the monthly growth of unremediated exposure and identifies the date beyond which a Voluntary Disclosure Agreement ceases to be advantageous, with a recommended decision deadline.',
  },
  {
    title: 'Sample data for evaluation',
    body: 'A built-in data seeder generates representative multi-state sales history so a fully populated exposure analysis can be reviewed immediately after sign-in.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-stone-950 text-stone-100">
      <nav className="flex items-center justify-between border-b border-stone-800 px-6 py-4">
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-black text-white">
            N
          </span>
          <span className="text-base font-semibold tracking-tight">NexusExposureQuantifier</span>
        </span>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/pricing" className="text-stone-300 hover:text-white">
            Pricing
          </Link>
          <Link href="/auth/sign-in" className="text-stone-300 hover:text-white">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-300">
          Backward-looking sales-tax exposure quantification
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          A documented, dated determination of unremediated sales-tax exposure, by state.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-stone-400">
          NexusExposureQuantifier computes back-tax, late-registration penalties, and statutory interest for each
          jurisdiction, accrued from the month economic nexus was first established, and models the register,
          disclose, or defer remediation paths so the finding can be presented to counsel, the board, or a
          counterparty's diligence team with a single citable figure.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-500"
          >
            Quantify exposure
          </Link>
          <Link
            href="/auth/sign-in"
            className="rounded-lg border border-stone-700 px-6 py-3 font-semibold text-stone-200 hover:bg-stone-800"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Problem */}
      <section className="border-y border-stone-800 bg-stone-900/40">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-2xl font-bold">Unremediated nexus exposure is a recurring diligence finding</h2>
          <p className="mt-4 max-w-3xl text-stone-400">
            Following <em>South Dakota v. Wayfair</em>, every state levying a sales tax now applies an economic-nexus
            threshold. Multi-state sellers routinely exceed these thresholds in numerous jurisdictions without
            registering. Absent a documented determination, the resulting liability is discovered, not managed, and
            typically at the least favorable moment.
          </p>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            <div className="rounded-xl border border-stone-800 bg-stone-900 p-5">
              <h3 className="font-semibold text-stone-100">Transaction risk</h3>
              <p className="mt-2 text-sm text-stone-400">
                An unquantified liability introduces uncertainty into a transaction, prompting escrow holdbacks,
                indemnification demands, or a direct reduction in purchase price.
              </p>
            </div>
            <div className="rounded-xl border border-stone-800 bg-stone-900 p-5">
              <h3 className="font-semibold text-stone-100">Time-sensitivity of remediation</h3>
              <p className="mt-2 text-sm text-stone-400">
                Exposure accrues monthly, and the Voluntary Disclosure Agreement remedy is foreclosed once a
                jurisdiction initiates an audit. The remediation window is not within the taxpayer's control to
                extend.
              </p>
            </div>
            <div className="rounded-xl border border-stone-800 bg-stone-900 p-5">
              <h3 className="font-semibold text-stone-100">Cost and reproducibility</h3>
              <p className="mt-2 text-sm text-stone-400">
                Engagement of outside consultants is costly and frequently yields a static, non-reproducible
                spreadsheet that cannot be independently re-run when underlying assumptions change.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold">A deterministic quantification engine</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-stone-400">
          Every figure produced is reproducible, cited to the rule and rate applied, and subject to immediate
          recomputation upon a change in assumptions.
        </p>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-stone-800 bg-stone-900 p-6">
              <h3 className="font-semibold text-blue-300">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-stone-800 bg-stone-900/40">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h2 className="text-3xl font-bold">Establish the figure before it is established for you.</h2>
          <p className="mx-auto mt-4 max-w-xl text-stone-400">
            Sign in, load representative multi-state sales data, and review a fully populated exposure analysis
            within seconds. All capabilities are available at no charge.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/auth/sign-up"
              className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-500"
            >
              Get started free
            </Link>
            <Link
              href="/pricing"
              className="rounded-lg border border-stone-700 px-6 py-3 font-semibold text-stone-200 hover:bg-stone-800"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-stone-800 py-8 text-center text-sm text-stone-600">
        <p>NexusExposureQuantifier — deterministic backward-looking sales-tax exposure analysis.</p>
        <p className="mt-1">Not a tax-filing service. Not a forward-looking nexus monitor.</p>
      </footer>
    </main>
  )
}
