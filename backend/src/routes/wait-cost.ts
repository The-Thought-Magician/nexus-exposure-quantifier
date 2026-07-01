import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  engagements,
  workspace_members,
  state_exposures,
  state_penalty_rules,
  state_interest_rates,
  state_vda_terms,
} from '../db/schema.js'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Ownership: the requesting user must own the engagement OR be a member of the
// engagement's workspace.
// ---------------------------------------------------------------------------
async function loadOwnedEngagement(engagementId: string, userId: string) {
  const [eng] = await db.select().from(engagements).where(eq(engagements.id, engagementId))
  if (!eng) return { eng: null, allowed: false }
  if (eng.user_id === userId) return { eng, allowed: true }
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, eng.workspace_id), eq(workspace_members.user_id, userId)))
  return { eng, allowed: !!member }
}

// ---------------------------------------------------------------------------
// GET /:engagementId  — wait-cost timeline + VDA-savings erosion + deadline.
//
// Projects, month by month over the requested horizon (?months, default 12),
// how the total exposure grows (additional penalty + interest accrue on the
// outstanding tax) and how the VDA savings erode as the lookback window walks
// forward and the un-waived interest keeps compounding. The decision deadline
// is the point where continued waiting flips VDA from net-positive to break-even.
// ---------------------------------------------------------------------------
router.get('/:engagementId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const monthsParam = parseInt(c.req.query('months') ?? '12', 10)
  const months = Number.isFinite(monthsParam) ? Math.max(1, Math.min(monthsParam, 60)) : 12

  // Per-state current exposure snapshot.
  const exposures = await db
    .select()
    .from(state_exposures)
    .where(eq(state_exposures.engagement_id, engagementId))

  const states = exposures.map((e) => e.state)

  // Reference rules keyed by state (latest effective).
  const penaltyRules = states.length
    ? await db
        .select()
        .from(state_penalty_rules)
        .where(inArray(state_penalty_rules.state, states))
        .orderBy(desc(state_penalty_rules.effective_date))
    : []
  const interestRates = states.length
    ? await db
        .select()
        .from(state_interest_rates)
        .where(inArray(state_interest_rates.state, states))
        .orderBy(desc(state_interest_rates.year))
    : []
  const vdaTerms = states.length
    ? await db.select().from(state_vda_terms).where(inArray(state_vda_terms.state, states))
    : []

  const penaltyByState = new Map<string, typeof penaltyRules[number]>()
  for (const p of penaltyRules) if (!penaltyByState.has(p.state)) penaltyByState.set(p.state, p)
  const interestByState = new Map<string, typeof interestRates[number]>()
  for (const r of interestRates) if (!interestByState.has(r.state)) interestByState.set(r.state, r)
  const vdaByState = new Map<string, typeof vdaTerms[number]>()
  for (const v of vdaTerms) vdaByState.set(v.state, v)

  // Baseline (wait = 0) totals.
  const baseTax = exposures.reduce((s, e) => s + (e.tax ?? 0), 0)
  const basePenalty = exposures.reduce((s, e) => s + (e.penalty ?? 0), 0)
  const baseInterest = exposures.reduce((s, e) => s + (e.interest ?? 0), 0)
  const baseTotal = exposures.reduce((s, e) => s + (e.total ?? 0), 0)
  const baseVdaTotal = exposures.reduce((s, e) => s + (e.vda_total ?? 0), 0)
  const baseVdaSavings = exposures.reduce((s, e) => s + (e.vda_savings ?? 0), 0)

  // Monthly accrual factors. Interest accrues on the outstanding (tax) balance;
  // additional failure-to-pay penalty keeps accruing up to its cap.
  function monthlyInterestRate(state: string): number {
    const r = interestByState.get(state)
    const annual = r?.annual_rate ?? 0.08
    return annual / 12
  }
  function monthlyPenaltyRate(state: string): number {
    const p = penaltyByState.get(state)
    // failure_to_pay_rate is expressed as a monthly accrual rate in the library.
    return p?.failure_to_pay_rate ?? 0.005
  }
  function penaltyCap(state: string, tax: number): number {
    const p = penaltyByState.get(state)
    if (p?.penalty_cap_rate == null) return Infinity
    return tax * p.penalty_cap_rate
  }

  // Build the month-by-month timeline.
  const timeline: Array<{
    month: number
    tax: number
    penalty: number
    interest: number
    total: number
    vda_total: number
    vda_savings: number
    incremental_cost: number
  }> = []

  // Track per-state accrued penalty/interest as we walk forward.
  const stateAccrual = new Map<string, { tax: number; penalty: number; interest: number }>()
  for (const e of exposures) {
    stateAccrual.set(e.state, { tax: e.tax ?? 0, penalty: e.penalty ?? 0, interest: e.interest ?? 0 })
  }

  let prevTotal = baseTotal
  for (let m = 0; m <= months; m++) {
    let tax = 0
    let penalty = 0
    let interest = 0
    let vdaTotal = 0

    for (const e of exposures) {
      const acc = stateAccrual.get(e.state)!
      if (m > 0) {
        // Accrue one additional month of interest on the tax balance.
        acc.interest += acc.tax * monthlyInterestRate(e.state)
        // Accrue one additional month of penalty, respecting the cap.
        const cap = penaltyCap(e.state, acc.tax)
        acc.penalty = Math.min(cap, acc.penalty + acc.tax * monthlyPenaltyRate(e.state))
      }
      tax += acc.tax
      penalty += acc.penalty
      interest += acc.interest

      // VDA total at this wait-month: penalties waived (per terms), tax owed for
      // the lookback window, interest treated per state. As time passes the
      // interest inside the VDA window still grows, so VDA total rises too.
      const v = vdaByState.get(e.state)
      const waivesPenalty = v?.waives_penalties ?? true
      const interestTreatment = v?.interest_treatment ?? 'full'
      const vdaInterest = interestTreatment === 'waived' ? 0 : acc.interest
      const vdaPenalty = waivesPenalty ? 0 : acc.penalty
      vdaTotal += acc.tax + vdaPenalty + vdaInterest
    }

    const total = tax + penalty + interest
    const vdaSavings = total - vdaTotal
    timeline.push({
      month: m,
      tax: round2(tax),
      penalty: round2(penalty),
      interest: round2(interest),
      total: round2(total),
      vda_total: round2(vdaTotal),
      vda_savings: round2(vdaSavings),
      incremental_cost: round2(total - prevTotal),
    })
    prevTotal = total
  }

  // Decision deadline: the last month at which VDA savings remain meaningfully
  // positive (>= 5% of the register-now total). Beyond that, waiting has eroded
  // the VDA advantage to a break-even zone.
  const thresholdSavings = baseTotal * 0.05
  let deadlineMonth = 0
  for (const pt of timeline) {
    if (pt.vda_savings >= thresholdSavings) deadlineMonth = pt.month
    else break
  }
  const deadlinePoint = timeline[deadlineMonth] ?? timeline[0]

  const deadline = {
    months_from_now: deadlineMonth,
    as_of_date: eng.as_of_date,
    projected_date: addMonthsISO(new Date(), deadlineMonth),
    vda_savings_at_deadline: deadlinePoint?.vda_savings ?? 0,
    threshold_savings: round2(thresholdSavings),
    rationale:
      deadlineMonth === 0
        ? 'VDA savings are already below the materiality threshold; act now.'
        : `VDA remains net-beneficial for approximately ${deadlineMonth} more month(s) before savings erode below 5% of current exposure.`,
  }

  return c.json({
    engagement_id: engagementId,
    horizon_months: months,
    baseline: {
      tax: round2(baseTax),
      penalty: round2(basePenalty),
      interest: round2(baseInterest),
      total: round2(baseTotal),
      vda_total: round2(baseVdaTotal),
      vda_savings: round2(baseVdaSavings),
    },
    timeline,
    deadline,
  })
})

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function addMonthsISO(base: Date, months: number): string {
  const d = new Date(base.getTime())
  d.setMonth(d.getMonth() + months)
  return d.toISOString()
}

export default router
