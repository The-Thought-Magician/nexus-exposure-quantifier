import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  engagements,
  workspace_members,
  assumptions,
  sales_lines,
  crossing_results,
  exposure_lines,
  state_exposures,
  state_tax_rates,
  state_penalty_rules,
  state_interest_rates,
  state_vda_terms,
  product_taxability,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Ownership helpers
// ---------------------------------------------------------------------------

async function loadEngagementForUser(engagementId: string, userId: string) {
  const [eng] = await db.select().from(engagements).where(eq(engagements.id, engagementId))
  if (!eng) return { eng: null as typeof engagements.$inferSelect | null, allowed: false }
  if (eng.user_id === userId) return { eng, allowed: true }
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, eng.workspace_id), eq(workspace_members.user_id, userId)))
  return { eng, allowed: !!member }
}

// ---------------------------------------------------------------------------
// Exposure math
// ---------------------------------------------------------------------------

function periodKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthsBetween(fromKey: string, toKey: string): number {
  const [fy, fm] = fromKey.split('-').map(Number)
  const [ty, tm] = toKey.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm)
}

function materialityBand(total: number): string {
  if (total >= 100_000) return 'critical'
  if (total >= 25_000) return 'high'
  if (total >= 5_000) return 'medium'
  return 'low'
}

interface ComputedState {
  state: string
  tax: number
  penalty: number
  interest: number
  total: number
  vda_tax: number
  vda_total: number
  vda_savings: number
  materiality_band: string
  lines: Array<{
    state: string
    period: string
    taxable_sales: number
    rate_applied: number
    tax: number
    penalty: number
    interest: number
  }>
}

/**
 * Core exposure computation for an engagement. Reads assumptions, crossings,
 * sales lines and the reference libraries, then builds per-period exposure line
 * items and per-state rollups (including VDA-limited totals and savings).
 */
async function computeExposureForEngagement(
  engagementId: string,
  asOf: Date,
): Promise<{ states: ComputedState[]; totals: Totals }> {
  // Assumptions (default to library-driven if none present).
  const [assump] = await db.select().from(assumptions).where(eq(assumptions.engagement_id, engagementId))
  const includeMarketplace = assump?.include_marketplace_sales ?? false
  const compounding = assump?.compounding ?? 'monthly'

  // Crossing results tell us which states have nexus and from when.
  const crossings = await db.select().from(crossing_results).where(eq(crossing_results.engagement_id, engagementId))
  const crossedByState = new Map<string, typeof crossing_results.$inferSelect>()
  for (const cr of crossings) {
    if (cr.has_crossed) crossedByState.set(cr.state, cr)
  }

  // Sales lines for the engagement.
  const lines = await db.select().from(sales_lines).where(eq(sales_lines.engagement_id, engagementId))

  // Reference libraries.
  const taxRates = await db.select().from(state_tax_rates)
  const penaltyRules = await db.select().from(state_penalty_rules)
  const interestRates = await db.select().from(state_interest_rates)
  const vdaTerms = await db.select().from(state_vda_terms)
  const taxability = await db.select().from(product_taxability).where(eq(product_taxability.engagement_id, engagementId))

  // Latest tax / penalty rule per state (by effective_date).
  const latestTax = new Map<string, typeof state_tax_rates.$inferSelect>()
  for (const r of taxRates) {
    const cur = latestTax.get(r.state)
    if (!cur || new Date(r.effective_date) > new Date(cur.effective_date)) latestTax.set(r.state, r)
  }
  const latestPenalty = new Map<string, typeof state_penalty_rules.$inferSelect>()
  for (const p of penaltyRules) {
    const cur = latestPenalty.get(p.state)
    if (!cur || new Date(p.effective_date) > new Date(cur.effective_date)) latestPenalty.set(p.state, p)
  }
  const interestByStateYear = new Map<string, number>()
  for (const ir of interestRates) interestByStateYear.set(`${ir.state}:${ir.year}`, ir.annual_rate)
  const vdaByState = new Map<string, typeof state_vda_terms.$inferSelect>()
  for (const v of vdaTerms) vdaByState.set(v.state, v)
  const taxabilityByKey = new Map<string, typeof product_taxability.$inferSelect>()
  for (const t of taxability) taxabilityByKey.set(`${t.state}:${t.product_category}`, t)

  const asOfKey = periodKey(asOf)

  // Aggregate taxable sales per (state, period), only for periods on/after crossing.
  interface Agg {
    state: string
    period: string
    taxableSales: number
  }
  const aggMap = new Map<string, Agg>()

  for (const line of lines) {
    const cr = crossedByState.get(line.state)
    if (!cr) continue // no nexus in this state → no exposure
    if (!line.is_taxable) continue
    if (line.is_marketplace && !includeMarketplace) continue

    // Product-taxability override: if a row exists and marks it non-taxable, skip.
    const override = taxabilityByKey.get(`${line.state}:${line.product_category ?? ''}`)
    if (override && !override.is_taxable) continue

    const saleDate = new Date(line.sale_date)
    const pKey = periodKey(saleDate)
    // Only accrue exposure from the crossing period onward and up to as-of.
    if (cr.crossing_date) {
      const crossKey = periodKey(new Date(cr.crossing_date))
      if (monthsBetween(crossKey, pKey) < 0) continue
    }
    if (monthsBetween(pKey, asOfKey) < 0) continue

    const key = `${line.state}:${pKey}`
    const existing = aggMap.get(key)
    if (existing) existing.taxableSales += line.amount
    else aggMap.set(key, { state: line.state, period: pKey, taxableSales: line.amount })
  }

  // Build per-state computed exposure.
  const byState = new Map<string, ComputedState>()

  for (const agg of aggMap.values()) {
    const rate = latestTax.get(agg.state)?.avg_combined_rate ?? 0
    const tax = agg.taxableSales * rate

    // Penalty: failure-to-file + failure-to-pay accrued over the delinquency
    // window (months from period to as-of), capped by penalty_cap_rate.
    const pr = latestPenalty.get(agg.state)
    let penalty = 0
    if (pr) {
      const monthsLate = Math.max(0, monthsBetween(agg.period, asOfKey))
      const ftfRate = pr.failure_to_file_rate ?? 0
      const ftpRate = pr.failure_to_pay_rate ?? 0
      const accrualMonths = pr.accrual === 'monthly' ? monthsLate : 1
      let pct = (ftfRate + ftpRate) * accrualMonths
      if (pr.penalty_cap_rate != null) pct = Math.min(pct, pr.penalty_cap_rate)
      penalty = tax * pct
      if (pr.min_penalty && penalty < pr.min_penalty && tax > 0) penalty = pr.min_penalty
    }

    // Interest: accrue per year from period to as-of using annual state rate.
    const monthsLate = Math.max(0, monthsBetween(agg.period, asOfKey))
    const [py] = agg.period.split('-').map(Number)
    let interest = 0
    if (monthsLate > 0) {
      const annual =
        interestByStateYear.get(`${agg.state}:${py}`) ??
        interestByStateYear.get(`${agg.state}:${asOf.getUTCFullYear()}`) ??
        0.08
      const years = monthsLate / 12
      if (compounding === 'monthly') {
        interest = tax * (Math.pow(1 + annual / 12, monthsLate) - 1)
      } else if (compounding === 'daily') {
        interest = tax * (Math.pow(1 + annual / 365, monthsLate * 30) - 1)
      } else {
        interest = tax * annual * years
      }
    }

    let cs = byState.get(agg.state)
    if (!cs) {
      cs = {
        state: agg.state,
        tax: 0,
        penalty: 0,
        interest: 0,
        total: 0,
        vda_tax: 0,
        vda_total: 0,
        vda_savings: 0,
        materiality_band: 'low',
        lines: [],
      }
      byState.set(agg.state, cs)
    }
    cs.tax += tax
    cs.penalty += penalty
    cs.interest += interest
    cs.lines.push({
      state: agg.state,
      period: agg.period,
      taxable_sales: agg.taxableSales,
      rate_applied: rate,
      tax,
      penalty,
      interest,
    })
  }

  // VDA-limited figures per state.
  for (const cs of byState.values()) {
    cs.lines.sort((a, b) => a.period.localeCompare(b.period))
    cs.total = cs.tax + cs.penalty + cs.interest

    const vda = vdaByState.get(cs.state)
    const lookbackYears = vda?.lookback_years ?? 4
    const waivesPenalties = vda?.waives_penalties ?? true
    const interestTreatment = vda?.interest_treatment ?? 'full'

    // VDA restricts tax to the lookback window (most recent N years of periods).
    const cutoffKey = `${asOf.getUTCFullYear() - lookbackYears}-${String(asOf.getUTCMonth() + 1).padStart(2, '0')}`
    let vdaTax = 0
    let vdaInterest = 0
    for (const ln of cs.lines) {
      if (monthsBetween(cutoffKey, ln.period) >= 0) {
        vdaTax += ln.tax
        vdaInterest += ln.interest
      }
    }
    const vdaPenalty = waivesPenalties ? 0 : cs.penalty
    const effVdaInterest = interestTreatment === 'waived' ? 0 : interestTreatment === 'reduced' ? vdaInterest * 0.5 : vdaInterest
    cs.vda_tax = vdaTax
    cs.vda_total = vdaTax + vdaPenalty + effVdaInterest
    cs.vda_savings = Math.max(0, cs.total - cs.vda_total)
    cs.materiality_band = materialityBand(cs.total)
  }

  const states = [...byState.values()].sort((a, b) => b.total - a.total)
  const totals = states.reduce<Totals>(
    (acc, s) => {
      acc.tax += s.tax
      acc.penalty += s.penalty
      acc.interest += s.interest
      acc.total += s.total
      acc.vda_savings += s.vda_savings
      return acc
    },
    { tax: 0, penalty: 0, interest: 0, total: 0, vda_savings: 0 },
  )
  return { states, totals }
}

interface Totals {
  tax: number
  penalty: number
  interest: number
  total: number
  vda_savings: number
}

/** Persist computed exposure: replace exposure_lines + upsert state_exposures + update engagement totals. */
async function persistExposure(engagementId: string, states: ComputedState[], totals: Totals) {
  const now = new Date()

  // Replace exposure line items.
  await db.delete(exposure_lines).where(eq(exposure_lines.engagement_id, engagementId))
  for (const s of states) {
    for (const ln of s.lines) {
      await db.insert(exposure_lines).values({
        engagement_id: engagementId,
        state: ln.state,
        period: ln.period,
        taxable_sales: ln.taxable_sales,
        rate_applied: ln.rate_applied,
        tax: ln.tax,
        penalty: ln.penalty,
        interest: ln.interest,
      })
    }
  }

  // Upsert per-state rollups.
  for (const s of states) {
    await db
      .insert(state_exposures)
      .values({
        engagement_id: engagementId,
        state: s.state,
        tax: s.tax,
        penalty: s.penalty,
        interest: s.interest,
        total: s.total,
        vda_tax: s.vda_tax,
        vda_total: s.vda_total,
        vda_savings: s.vda_savings,
        materiality_band: s.materiality_band,
        computed_at: now,
      })
      .onConflictDoUpdate({
        target: [state_exposures.engagement_id, state_exposures.state],
        set: {
          tax: s.tax,
          penalty: s.penalty,
          interest: s.interest,
          total: s.total,
          vda_tax: s.vda_tax,
          vda_total: s.vda_total,
          vda_savings: s.vda_savings,
          materiality_band: s.materiality_band,
          computed_at: now,
        },
      })
  }

  // Drop rollups for states that no longer have exposure.
  const keepStates = new Set(states.map((s) => s.state))
  const existingRollups = await db.select().from(state_exposures).where(eq(state_exposures.engagement_id, engagementId))
  for (const r of existingRollups) {
    if (!keepStates.has(r.state)) {
      await db.delete(state_exposures).where(eq(state_exposures.id, r.id))
    }
  }

  // Update engagement totals.
  await db
    .update(engagements)
    .set({
      total_tax: totals.tax,
      total_penalty: totals.penalty,
      total_interest: totals.interest,
      total_exposure: totals.total,
      total_vda_savings: totals.vda_savings,
      updated_at: now,
    })
    .where(eq(engagements.id, engagementId))
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /:engagementId — per-state exposure rollups (public read where engagement is accessible).
router.get('/:engagementId', authMiddleware, async (c) => {
  const engagementId = c.req.param('engagementId')
  const userId = getUserId(c)
  const { eng, allowed } = await loadEngagementForUser(engagementId, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select()
    .from(state_exposures)
    .where(eq(state_exposures.engagement_id, engagementId))
    .orderBy(desc(state_exposures.total))
  return c.json(rows)
})

// GET /:engagementId/:state — one state's period line items + rollup.
router.get('/:engagementId/:state', authMiddleware, async (c) => {
  const engagementId = c.req.param('engagementId')
  const state = c.req.param('state').toUpperCase()
  const userId = getUserId(c)
  const { eng, allowed } = await loadEngagementForUser(engagementId, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const [exposure] = await db
    .select()
    .from(state_exposures)
    .where(and(eq(state_exposures.engagement_id, engagementId), eq(state_exposures.state, state)))
  const lines = await db
    .select()
    .from(exposure_lines)
    .where(and(eq(exposure_lines.engagement_id, engagementId), eq(exposure_lines.state, state)))
    .orderBy(exposure_lines.period)
  return c.json({ exposure: exposure ?? null, lines })
})

// POST /:engagementId/compute — compute tax+penalty+interest+VDA, persist.
const computeSchema = z
  .object({
    as_of_date: z.string().datetime().optional(),
  })
  .optional()

router.post('/:engagementId/compute', authMiddleware, zValidator('json', computeSchema), async (c) => {
  const engagementId = c.req.param('engagementId')
  const userId = getUserId(c)
  const { eng, allowed } = await loadEngagementForUser(engagementId, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)
  if (eng.is_locked) return c.json({ error: 'Engagement is locked' }, 409)

  const body = c.req.valid('json') as { as_of_date?: string } | undefined
  const asOf = body?.as_of_date ? new Date(body.as_of_date) : new Date(eng.as_of_date)

  const { states, totals } = await computeExposureForEngagement(engagementId, asOf)
  await persistExposure(engagementId, states, totals)

  return c.json({
    ok: true,
    totals: {
      tax: totals.tax,
      penalty: totals.penalty,
      interest: totals.interest,
      total: totals.total,
      vda_savings: totals.vda_savings,
      states: states.length,
    },
  })
})

export default router
export { computeExposureForEngagement, loadEngagementForUser, materialityBand, monthsBetween, periodKey }
export type { ComputedState, Totals }
