import { Hono } from 'hono'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  engagements,
  workspace_members,
  state_exposures,
  sales_lines,
  crossing_results,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Ownership helpers
// ---------------------------------------------------------------------------

/** Workspace ids the user owns or is a member of. */
async function accessibleWorkspaceIds(userId: string): Promise<string[]> {
  const memberships = await db
    .select({ workspace_id: workspace_members.workspace_id })
    .from(workspace_members)
    .where(eq(workspace_members.user_id, userId))
  return [...new Set(memberships.map((m) => m.workspace_id))]
}

/**
 * Engagements the user can see: those they created OR those inside a workspace
 * they belong to. Optionally filtered to a single workspace.
 */
async function accessibleEngagements(userId: string, workspaceId?: string) {
  const wsIds = await accessibleWorkspaceIds(userId)
  const all = await db.select().from(engagements)
  return all.filter((e) => {
    if (workspaceId && e.workspace_id !== workspaceId) return false
    return e.user_id === userId || wsIds.includes(e.workspace_id)
  })
}

/** Verify the user can access a specific engagement; returns it or null. */
async function getAccessibleEngagement(userId: string, engagementId: string) {
  const [eng] = await db.select().from(engagements).where(eq(engagements.id, engagementId))
  if (!eng) return null
  if (eng.user_id === userId) return eng
  const wsIds = await accessibleWorkspaceIds(userId)
  if (wsIds.includes(eng.workspace_id)) return eng
  return null
}

// ---------------------------------------------------------------------------
// GET /overview — KPI tiles across engagements (?workspace_id)
// ---------------------------------------------------------------------------

router.get('/overview', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id') || undefined

  const engs = await accessibleEngagements(userId, workspaceId)

  let totalTax = 0
  let totalPenalty = 0
  let totalInterest = 0
  let totalExposure = 0
  let totalVdaSavings = 0
  let lockedCount = 0
  const statusCounts: Record<string, number> = {}

  for (const e of engs) {
    totalTax += e.total_tax ?? 0
    totalPenalty += e.total_penalty ?? 0
    totalInterest += e.total_interest ?? 0
    totalExposure += e.total_exposure ?? 0
    totalVdaSavings += e.total_vda_savings ?? 0
    if (e.is_locked) lockedCount += 1
    statusCounts[e.status] = (statusCounts[e.status] ?? 0) + 1
  }

  const engIds = engs.map((e) => e.id)

  // Count states with a crossed nexus across accessible engagements.
  let statesWithNexus = 0
  let statesAnalyzed = 0
  if (engIds.length > 0) {
    const crossings = await db
      .select()
      .from(crossing_results)
      .where(inArray(crossing_results.engagement_id, engIds))
    const crossedStates = new Set<string>()
    const analyzedStates = new Set<string>()
    for (const cr of crossings) {
      analyzedStates.add(cr.state)
      if (cr.has_crossed) crossedStates.add(cr.state)
    }
    statesWithNexus = crossedStates.size
    statesAnalyzed = analyzedStates.size
  }

  const tiles = {
    engagement_count: engs.length,
    locked_count: lockedCount,
    total_tax: totalTax,
    total_penalty: totalPenalty,
    total_interest: totalInterest,
    total_exposure: totalExposure,
    total_vda_savings: totalVdaSavings,
    states_with_nexus: statesWithNexus,
    states_analyzed: statesAnalyzed,
    status_breakdown: statusCounts,
  }

  return c.json({ tiles })
})

// ---------------------------------------------------------------------------
// GET /by-state — exposure-by-state heat ranking (?engagement_id)
// ---------------------------------------------------------------------------

router.get('/by-state', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.query('engagement_id') || undefined

  let engIds: string[]
  if (engagementId) {
    const eng = await getAccessibleEngagement(userId, engagementId)
    if (!eng) return c.json({ error: 'Not found' }, 404)
    engIds = [eng.id]
  } else {
    const engs = await accessibleEngagements(userId)
    engIds = engs.map((e) => e.id)
  }

  if (engIds.length === 0) return c.json([])

  const rows = await db
    .select()
    .from(state_exposures)
    .where(inArray(state_exposures.engagement_id, engIds))

  // Aggregate per state across the selected engagements.
  const byState = new Map<
    string,
    {
      state: string
      tax: number
      penalty: number
      interest: number
      total: number
      vda_tax: number
      vda_total: number
      vda_savings: number
      engagement_count: number
    }
  >()

  for (const r of rows) {
    let agg = byState.get(r.state)
    if (!agg) {
      agg = {
        state: r.state,
        tax: 0,
        penalty: 0,
        interest: 0,
        total: 0,
        vda_tax: 0,
        vda_total: 0,
        vda_savings: 0,
        engagement_count: 0,
      }
      byState.set(r.state, agg)
    }
    agg.tax += r.tax ?? 0
    agg.penalty += r.penalty ?? 0
    agg.interest += r.interest ?? 0
    agg.total += r.total ?? 0
    agg.vda_tax += r.vda_tax ?? 0
    agg.vda_total += r.vda_total ?? 0
    agg.vda_savings += r.vda_savings ?? 0
    agg.engagement_count += 1
  }

  const ranking = [...byState.values()].sort((a, b) => b.total - a.total)
  const maxTotal = ranking.length > 0 ? ranking[0].total : 0

  // Assign a heat intensity (0..1) and a materiality band relative to the max.
  const heat = ranking.map((r, idx) => {
    const intensity = maxTotal > 0 ? r.total / maxTotal : 0
    let band: 'high' | 'medium' | 'low'
    if (intensity >= 0.66) band = 'high'
    else if (intensity >= 0.33) band = 'medium'
    else band = 'low'
    return { ...r, rank: idx + 1, intensity, band }
  })

  return c.json(heat)
})

// ---------------------------------------------------------------------------
// GET /trend/:engagementId — exposure trend as data added
// ---------------------------------------------------------------------------

router.get('/trend/:engagementId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')

  const eng = await getAccessibleEngagement(userId, engagementId)
  if (!eng) return c.json({ error: 'Not found' }, 404)

  // Build a month-by-month cumulative trend from the engagement's sales lines,
  // projecting exposure with the engagement's blended effective tax rate.
  const lines = await db
    .select()
    .from(sales_lines)
    .where(eq(sales_lines.engagement_id, engagementId))
    .orderBy(sales_lines.sale_date)

  // Effective rate derived from computed totals when available, else a default.
  const totalExposure = eng.total_exposure ?? 0
  const totalTax = eng.total_tax ?? 0

  // Sum taxable sales to derive a blended rate; fall back to a nominal 6%.
  let taxableSalesTotal = 0
  for (const l of lines) {
    if (l.is_taxable) taxableSalesTotal += l.amount ?? 0
  }
  const blendedRate = taxableSalesTotal > 0 && totalTax > 0 ? totalTax / taxableSalesTotal : 0.06

  // Group cumulative taxable sales by month period (YYYY-MM).
  const monthly = new Map<string, { taxable: number; gross: number; count: number }>()
  for (const l of lines) {
    const d = l.sale_date instanceof Date ? l.sale_date : new Date(l.sale_date as unknown as string)
    if (Number.isNaN(d.getTime())) continue
    const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    let m = monthly.get(period)
    if (!m) {
      m = { taxable: 0, gross: 0, count: 0 }
      monthly.set(period, m)
    }
    m.gross += l.amount ?? 0
    if (l.is_taxable) m.taxable += l.amount ?? 0
    m.count += 1
  }

  const periods = [...monthly.keys()].sort()
  let cumulativeTaxable = 0
  let cumulativeGross = 0
  let cumulativeCount = 0

  const trend = periods.map((period) => {
    const m = monthly.get(period)!
    cumulativeTaxable += m.taxable
    cumulativeGross += m.gross
    cumulativeCount += m.count
    return {
      period,
      period_taxable_sales: m.taxable,
      period_gross_sales: m.gross,
      period_transactions: m.count,
      cumulative_taxable_sales: cumulativeTaxable,
      cumulative_gross_sales: cumulativeGross,
      cumulative_transactions: cumulativeCount,
      projected_tax: cumulativeTaxable * blendedRate,
    }
  })

  return c.json({
    engagement_id: engagementId,
    blended_rate: blendedRate,
    total_tax: totalTax,
    total_exposure: totalExposure,
    trend,
  })
})

export default router
