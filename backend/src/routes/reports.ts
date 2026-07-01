import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  engagements,
  workspaces,
  workspace_members,
  assumptions,
  exposure_lines,
  state_exposures,
  crossing_results,
  scenarios,
  sales_lines,
} from '../db/schema.js'
import { eq, and, asc, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

router.use('*', authMiddleware)

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

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// ---------------------------------------------------------------------------
// GET /:engagementId/working-papers — period-by-period export rows.
//
// One row per (state, period) drawn from exposure_lines, the granular audit
// trail: taxable sales, rate applied, and the tax/penalty/interest computed
// for that period. Sorted by state then period for a tie-out-ready worksheet.
// ---------------------------------------------------------------------------
router.get('/:engagementId/working-papers', async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const lines = await db
    .select()
    .from(exposure_lines)
    .where(eq(exposure_lines.engagement_id, engagementId))
    .orderBy(asc(exposure_lines.state), asc(exposure_lines.period))

  const rows = lines.map((l) => ({
    state: l.state,
    period: l.period,
    taxable_sales: round2(l.taxable_sales ?? 0),
    rate_applied: l.rate_applied ?? 0,
    tax: round2(l.tax ?? 0),
    penalty: round2(l.penalty ?? 0),
    interest: round2(l.interest ?? 0),
    total: round2((l.tax ?? 0) + (l.penalty ?? 0) + (l.interest ?? 0)),
  }))

  const totals = rows.reduce(
    (acc, r) => {
      acc.taxable_sales += r.taxable_sales
      acc.tax += r.tax
      acc.penalty += r.penalty
      acc.interest += r.interest
      acc.total += r.total
      return acc
    },
    { taxable_sales: 0, tax: 0, penalty: 0, interest: 0, total: 0 },
  )

  return c.json({
    engagement_id: engagementId,
    as_of_date: eng.as_of_date,
    rows,
    totals: {
      taxable_sales: round2(totals.taxable_sales),
      tax: round2(totals.tax),
      penalty: round2(totals.penalty),
      interest: round2(totals.interest),
      total: round2(totals.total),
    },
  })
})

// ---------------------------------------------------------------------------
// GET /:engagementId/schedule — consolidated per-state exposure schedule.
//
// One row per state from state_exposures with the register-now vs VDA columns
// and materiality band, plus a grand-total footer. This is the headline
// exposure schedule for the diligence binder.
// ---------------------------------------------------------------------------
router.get('/:engagementId/schedule', async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const exposures = await db
    .select()
    .from(state_exposures)
    .where(eq(state_exposures.engagement_id, engagementId))
    .orderBy(desc(state_exposures.total))

  const crossings = await db
    .select()
    .from(crossing_results)
    .where(eq(crossing_results.engagement_id, engagementId))
  const crossingByState = new Map(crossings.map((x) => [x.state, x]))

  const rows = exposures.map((e) => {
    const x = crossingByState.get(e.state)
    return {
      state: e.state,
      has_crossed: x?.has_crossed ?? false,
      crossing_date: x?.crossing_date ?? null,
      tax: round2(e.tax ?? 0),
      penalty: round2(e.penalty ?? 0),
      interest: round2(e.interest ?? 0),
      total: round2(e.total ?? 0),
      vda_tax: round2(e.vda_tax ?? 0),
      vda_total: round2(e.vda_total ?? 0),
      vda_savings: round2(e.vda_savings ?? 0),
      materiality_band: e.materiality_band ?? 'low',
    }
  })

  const totals = rows.reduce(
    (acc, r) => {
      acc.tax += r.tax
      acc.penalty += r.penalty
      acc.interest += r.interest
      acc.total += r.total
      acc.vda_tax += r.vda_tax
      acc.vda_total += r.vda_total
      acc.vda_savings += r.vda_savings
      return acc
    },
    { tax: 0, penalty: 0, interest: 0, total: 0, vda_tax: 0, vda_total: 0, vda_savings: 0 },
  )

  return c.json({
    engagement_id: engagementId,
    as_of_date: eng.as_of_date,
    rows,
    totals: {
      tax: round2(totals.tax),
      penalty: round2(totals.penalty),
      interest: round2(totals.interest),
      total: round2(totals.total),
      vda_tax: round2(totals.vda_tax),
      vda_total: round2(totals.vda_total),
      vda_savings: round2(totals.vda_savings),
    },
  })
})

// ---------------------------------------------------------------------------
// GET /:engagementId/summary — diligence-binder summary object.
//
// A single consolidated object suitable for the front page of a diligence
// binder: engagement + workspace identity, the assumptions used, headline
// exposure totals, count of states with nexus, top exposure states, the
// recommended scenario, and the VDA opportunity.
// ---------------------------------------------------------------------------
router.get('/:engagementId/summary', async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, eng.workspace_id))
  const [assump] = await db
    .select()
    .from(assumptions)
    .where(eq(assumptions.engagement_id, engagementId))

  const exposures = await db
    .select()
    .from(state_exposures)
    .where(eq(state_exposures.engagement_id, engagementId))
    .orderBy(desc(state_exposures.total))

  const crossings = await db
    .select()
    .from(crossing_results)
    .where(eq(crossing_results.engagement_id, engagementId))
  const crossedStates = crossings.filter((x) => x.has_crossed)

  const scenarioRows = await db
    .select()
    .from(scenarios)
    .where(eq(scenarios.engagement_id, engagementId))
    .orderBy(desc(scenarios.computed_at))
  const recommended = scenarioRows.find((s) => s.is_recommended) ?? null

  const salesAgg = await db
    .select()
    .from(sales_lines)
    .where(eq(sales_lines.engagement_id, engagementId))
  const totalSales = salesAgg.reduce((s, r) => s + (r.amount ?? 0), 0)

  const totalTax = exposures.reduce((s, e) => s + (e.tax ?? 0), 0)
  const totalPenalty = exposures.reduce((s, e) => s + (e.penalty ?? 0), 0)
  const totalInterest = exposures.reduce((s, e) => s + (e.interest ?? 0), 0)
  const totalExposure = exposures.reduce((s, e) => s + (e.total ?? 0), 0)
  const totalVdaSavings = exposures.reduce((s, e) => s + (e.vda_savings ?? 0), 0)

  const bandCounts = exposures.reduce<Record<string, number>>((acc, e) => {
    const b = e.materiality_band ?? 'low'
    acc[b] = (acc[b] ?? 0) + 1
    return acc
  }, {})

  return c.json({
    engagement: {
      id: eng.id,
      name: eng.name,
      description: eng.description,
      as_of_date: eng.as_of_date,
      status: eng.status,
      is_locked: eng.is_locked,
    },
    workspace: ws
      ? { id: ws.id, name: ws.name, legal_name: ws.legal_name, fiscal_year_end: ws.fiscal_year_end }
      : null,
    assumptions: assump ?? null,
    totals: {
      total_sales: round2(totalSales),
      tax: round2(totalTax),
      penalty: round2(totalPenalty),
      interest: round2(totalInterest),
      total_exposure: round2(totalExposure),
      vda_savings: round2(totalVdaSavings),
    },
    nexus: {
      states_with_nexus: crossedStates.length,
      states_analyzed: crossings.length,
      crossed_states: crossedStates.map((x) => x.state),
    },
    materiality_bands: bandCounts,
    top_states: exposures.slice(0, 5).map((e) => ({
      state: e.state,
      total: round2(e.total ?? 0),
      vda_savings: round2(e.vda_savings ?? 0),
      materiality_band: e.materiality_band ?? 'low',
    })),
    recommended_scenario: recommended
      ? {
          kind: recommended.kind,
          wait_months: recommended.wait_months,
          total: round2(recommended.total ?? 0),
          total_tax: round2(recommended.total_tax ?? 0),
          total_penalty: round2(recommended.total_penalty ?? 0),
          total_interest: round2(recommended.total_interest ?? 0),
        }
      : null,
    generated_at: new Date().toISOString(),
  })
})

export default router
