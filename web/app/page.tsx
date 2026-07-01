import Link from 'next/link'

const features = [
  {
    title: 'Retroactive crossing-date detector',
    body: 'Walks your historical sales chronologically per state and pinpoints the exact month each economic-nexus threshold was first crossed, honoring rolling-12-month vs calendar-year windows and dual sales/transaction tests.',
  },
  {
    title: 'Per-state uncollected-tax estimator',
    body: 'From each crossing date forward to your as-of date, applies the state effective rate to taxable sales, period by period, matching the state filing frequency, for a defensible base-tax subtotal.',
  },
  {
    title: 'Penalty and interest accrual',
    body: 'Encodes each state failure-to-file / failure-to-pay penalty schedule, caps and minimums, plus statutory interest by year and compounding convention, accrued to today.',
  },
  {
    title: 'VDA lookback modeler',
    body: 'Re-runs the full exposure under a Voluntary Disclosure Agreement, capping the lookback window and waiving penalties, then quantifies the savings versus doing nothing.',
  },
  {
    title: 'Register vs VDA vs wait',
    body: 'Compares the three remediation paths on one screen, each with a total dollar figure and per-state breakdown, and recommends a path based on materiality and savings.',
  },
  {
    title: 'Board-ready exposure memos',
    body: 'Generates auditor-ready per-state and consolidated memos with methodology, assumptions, citations, and an as-of-date stamp, exportable for the data room.',
  },
  {
    title: 'Materiality ranking',
    body: 'Ranks states by exposure with configurable high/medium/low banding so you know which states drive most of the liability.',
  },
  {
    title: 'Wait-cost timeline',
    body: 'Projects how exposure grows each month you wait and the date a VDA stops being worthwhile, with a recommended decision deadline.',
  },
  {
    title: 'One-click sample data',
    body: 'A built-in seeder synthesizes realistic multi-state sales history so you can see a fully populated exposure analysis within seconds of signing in.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-sm font-black text-white">
            N
          </span>
          <span className="text-base font-semibold tracking-tight">NexusExposureQuantifier</span>
        </span>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/pricing" className="text-slate-300 hover:text-white">
            Pricing
          </Link>
          <Link href="/auth/sign-in" className="text-slate-300 hover:text-white">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-violet-600 px-4 py-2 font-medium text-white hover:bg-violet-500"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
          Backward-looking sales-tax exposure engine
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          Turn "we probably owe sales tax somewhere" into a dated, defensible number.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          NexusExposureQuantifier computes back-tax, late-registration penalties, and statutory interest per state,
          accrued from the exact month you crossed each nexus threshold, then models register-now vs VDA vs wait so
          your CFO gets one citable figure for the diligence binder.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-violet-600 px-6 py-3 font-semibold text-white hover:bg-violet-500"
          >
            Quantify my exposure
          </Link>
          <Link
            href="/auth/sign-in"
            className="rounded-lg border border-slate-700 px-6 py-3 font-semibold text-slate-200 hover:bg-slate-800"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Problem */}
      <section className="border-y border-slate-800 bg-slate-900/40">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-2xl font-bold">Unremediated exposure is a top diligence finding</h2>
          <p className="mt-4 max-w-3xl text-slate-400">
            Since <em>South Dakota v. Wayfair</em>, every state with a sales tax has an economic-nexus threshold.
            Software and e-commerce companies blow past them in a dozen states without registering. It surfaces at the
            worst time.
          </p>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h3 className="font-semibold text-slate-100">Deal risk</h3>
              <p className="mt-2 text-sm text-slate-400">
                An un-sized liability kills deals, forces escrow holdbacks, or carves a dollar-for-dollar cut from the
                purchase price.
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h3 className="font-semibold text-slate-100">Time pressure</h3>
              <p className="mt-2 text-sm text-slate-400">
                Exposure grows every month, and a VDA is foreclosed the moment a state opens an audit. The clock is not
                yours to control.
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h3 className="font-semibold text-slate-100">Cost and opacity</h3>
              <p className="mt-2 text-sm text-slate-400">
                Consultants charge four to five figures for an opaque spreadsheet the CFO cannot independently re-run
                when assumptions change.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold">A deterministic engine, not a spreadsheet</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
          Every number is reproducible, cited to the rule and rate used, and re-runnable the instant an assumption
          changes.
        </p>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h3 className="font-semibold text-violet-300">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-800 bg-slate-900/40">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h2 className="text-3xl font-bold">Size it before the buyer's accountants do.</h2>
          <p className="mx-auto mt-4 max-w-xl text-slate-400">
            Sign in, seed sample multi-state sales, and see a fully populated exposure analysis in seconds. All
            features free.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/auth/sign-up"
              className="rounded-lg bg-violet-600 px-6 py-3 font-semibold text-white hover:bg-violet-500"
            >
              Get started free
            </Link>
            <Link
              href="/pricing"
              className="rounded-lg border border-slate-700 px-6 py-3 font-semibold text-slate-200 hover:bg-slate-800"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center text-sm text-slate-600">
        <p>NexusExposureQuantifier — deterministic backward-looking sales-tax exposure analysis.</p>
        <p className="mt-1">Not a tax-filing service. Not a forward-looking nexus monitor.</p>
      </footer>
    </main>
  )
}
