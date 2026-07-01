import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  engagements,
  workspaces,
  workspace_members,
  assumptions,
  sales_lines,
  state_nexus_rules,
  state_tax_rates,
  state_penalty_rules,
  state_interest_rates,
  state_vda_terms,
  crossing_results,
  exposure_lines,
  state_exposures,
  scenarios,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().default(''),
  as_of_date: z.string().optional(),
  status: z.enum(['draft', 'in_review', 'final']).optional().default('draft'),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  as_of_date: z.string().optional(),
  status: z.enum(['draft', 'in_review', 'final']).optional(),
})

const cloneSchema = z.object({
  name: z.string().min(1).optional(),
  workspace_id: z.string().min(1).optional(),
})

const lockSchema = z.object({
  is_locked: z.boolean(),
})

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

async function isWorkspaceMember(workspaceId: string, userId: string) {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, workspaceId),
        eq(workspace_members.user_id, userId),
      ),
    )
  return !!m
}

/** Return engagement if the user owns it or is a member of its workspace. */
async function engagementForUser(id: string, userId: string) {
  const [eng] = await db.select().from(engagements).where(eq(engagements.id, id))
  if (!eng) return null
  if (eng.user_id === userId) return eng
  return (await isWorkspaceMember(eng.workspace_id, userId)) ? eng : null
}

async function logActivity(workspaceId: string, userId: string, action: string, target: string) {
  try {
    await db.insert(activity_log).values({ workspace_id: workspaceId, user_id: userId, action, target })
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Compute pipeline (crossings -> exposure -> scenarios -> totals)
// ---------------------------------------------------------------------------

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth())
}

interface Assumptions {
  include_marketplace_sales: boolean
  include_exempt_in_measure: boolean
  compounding: string
}

/** Latest reference row per state keyed by effective_date (or year for interest). */
async function loadReferenceData() {
  const [nexus, tax, penalty, interest, vda] = await Promise.all([
    db.select().from(state_nexus_rules),
    db.select().from(state_tax_rates),
    db.select().from(state_penalty_rules),
    db.select().from(state_interest_rates),
    db.select().from(state_vda_terms),
  ])

  const latestByState = <T extends { state: string; effective_date: Date }>(rows: T[]) => {
    const map = new Map<string, T>()
    for (const r of rows) {
      const cur = map.get(r.state)
      if (!cur || new Date(r.effective_date).getTime() > new Date(cur.effective_date).getTime()) {
        map.set(r.state, r)
      }
    }
    return map
  }

  const interestByStateYear = new Map<string, Map<number, (typeof interest)[number]>>()
  for (const r of interest) {
    if (!interestByStateYear.has(r.state)) interestByStateYear.set(r.state, new Map())
    interestByStateYear.get(r.state)!.set(r.year, r)
  }
  const vdaByState = new Map(vda.map((v) => [v.state, v]))

  return {
    nexus: latestByState(nexus as Array<{ state: string; effective_date: Date }> & typeof nexus),
    tax: latestByState(tax as Array<{ state: string; effective_date: Date }> & typeof tax),
    penalty: latestByState(penalty as Array<{ state: string; effective_date: Date }> & typeof penalty),
    interestByStateYear,
    vdaByState,
  }
}

/**
 * Run the full computation pipeline for an engagement over its sales lines and
 * the reference libraries, persisting crossing_results, exposure_lines,
 * state_exposures and scenarios, and returning the engagement totals.
 */
async function runPipeline(engagementId: string, asOf: Date, a: Assumptions) {
  const lines = await db
    .select()
    .from(sales_lines)
    .where(eq(sales_lines.engagement_id, engagementId))
  const ref = await loadReferenceData()

  // Group sales by state, sorted by date.
  const byState = new Map<string, typeof lines>()
  for (const l of lines) {
    if (!byState.has(l.state)) byState.set(l.state, [])
    byState.get(l.state)!.push(l)
  }

  // Wipe prior computed rows for this engagement.
  await db.delete(crossing_results).where(eq(crossing_results.engagement_id, engagementId))
  await db.delete(exposure_lines).where(eq(exposure_lines.engagement_id, engagementId))
  await db.delete(state_exposures).where(eq(state_exposures.engagement_id, engagementId))
  await db.delete(scenarios).where(eq(scenarios.engagement_id, engagementId))

  let totalTax = 0
  let totalPenalty = 0
  let totalInterest = 0
  let totalVdaSavings = 0
  const perStateRegister: Array<{ state: string; tax: number; penalty: number; interest: number; total: number }> = []
  const perStateVda: Array<{ state: string; tax: number; penalty: number; interest: number; total: number }> = []

  for (const [state, stateLines] of byState) {
    stateLines.sort((x, y) => new Date(x.sale_date).getTime() - new Date(y.sale_date).getTime())
    const nexusRule = ref.nexus.get(state)
    const taxRate = ref.tax.get(state)
    const penaltyRule = ref.penalty.get(state)
    const vda = ref.vdaByState.get(state)

    // --- Crossing detection (rolling running measure) ---
    // Build a per-period timeline of measure sales / transaction counts.
    const salesThreshold = nexusRule?.sales_threshold ?? Infinity
    const txnThreshold = nexusRule?.transaction_threshold ?? null
    const countsMarketplace = nexusRule?.counts_marketplace ?? true
    const includesExempt = nexusRule?.includes_exempt ?? true

    // A line contributes to the nexus MEASURE unless excluded by assumptions/rule.
    const inMeasure = (l: (typeof stateLines)[number]) => {
      if (l.is_marketplace && !(countsMarketplace && a.include_marketplace_sales)) {
        // marketplace only counts when both the rule and assumptions include it
        if (!countsMarketplace) return false
        if (!a.include_marketplace_sales) return false
      }
      if (!l.is_taxable && !(includesExempt && a.include_exempt_in_measure)) return false
      return true
    }

    const timeline: Array<{ period: string; sales: number; txns: number; running_sales: number; running_txns: number }> = []
    const periodMap = new Map<string, { sales: number; txns: number }>()
    for (const l of stateLines) {
      const k = monthKey(new Date(l.sale_date))
      if (!periodMap.has(k)) periodMap.set(k, { sales: 0, txns: 0 })
      if (inMeasure(l)) {
        const p = periodMap.get(k)!
        p.sales += l.amount
        p.txns += 1
      } else if (!periodMap.get(k)) {
        periodMap.set(k, { sales: 0, txns: 0 })
      }
    }

    let runningSales = 0
    let runningTxns = 0
    let hasCrossed = false
    let crossingDate: Date | null = null
    let trippingTest: string | null = null
    let measureAtCrossing: number | null = null
    let thresholdUsed: number | null = null

    const sortedPeriods = [...periodMap.keys()].sort()
    for (const k of sortedPeriods) {
      const p = periodMap.get(k)!
      runningSales += p.sales
      runningTxns += p.txns
      timeline.push({ period: k, sales: p.sales, txns: p.txns, running_sales: runningSales, running_txns: runningTxns })
      if (!hasCrossed) {
        const salesTrip = runningSales >= salesThreshold
        const txnTrip = txnThreshold != null && runningTxns >= txnThreshold
        if (salesTrip || txnTrip) {
          hasCrossed = true
          crossingDate = new Date(`${k}-01T00:00:00.000Z`)
          if (salesTrip && txnTrip) trippingTest = 'both'
          else if (salesTrip) trippingTest = 'sales'
          else trippingTest = 'transactions'
          measureAtCrossing = salesTrip ? runningSales : runningTxns
          thresholdUsed = salesTrip ? salesThreshold : (txnThreshold ?? 0)
        }
      }
    }

    await db.insert(crossing_results).values({
      engagement_id: engagementId,
      state,
      has_crossed: hasCrossed,
      crossing_date: crossingDate,
      tripping_test: trippingTest,
      measure_at_crossing: measureAtCrossing,
      threshold_used: thresholdUsed,
      timeline,
    })

    if (!hasCrossed || !crossingDate) {
      // No exposure until nexus is established.
      continue
    }

    // --- Exposure: liability accrues from the crossing date forward ---
    const rate = taxRate?.avg_combined_rate ?? taxRate?.base_rate ?? 0
    // Per-period taxable sales (post-crossing), grouped by month.
    const taxablePeriods = new Map<string, number>()
    for (const l of stateLines) {
      const d = new Date(l.sale_date)
      if (d.getTime() < crossingDate.getTime()) continue
      if (!l.is_taxable) continue
      if (l.is_marketplace && !a.include_marketplace_sales) continue
      const k = monthKey(d)
      taxablePeriods.set(k, (taxablePeriods.get(k) ?? 0) + l.amount)
    }

    let stateTax = 0
    let statePenalty = 0
    let stateInterest = 0
    const failToFile = penaltyRule?.failure_to_file_rate ?? 0
    const failToPay = penaltyRule?.failure_to_pay_rate ?? 0
    const penaltyCap = penaltyRule?.penalty_cap_rate ?? null
    const minPenalty = penaltyRule?.min_penalty ?? 0

    for (const [k, taxable] of taxablePeriods) {
      const tax = taxable * rate
      const periodDate = new Date(`${k}-01T00:00:00.000Z`)
      const monthsElapsed = Math.max(0, monthsBetween(periodDate, asOf))

      // Penalty: combined failure-to-file + failure-to-pay accruing monthly, capped.
      let penaltyRateApplied = (failToFile + failToPay) * monthsElapsed
      if (penaltyCap != null) penaltyRateApplied = Math.min(penaltyRateApplied, penaltyCap)
      let penalty = tax * penaltyRateApplied
      if (tax > 0) penalty = Math.max(penalty, minPenalty)

      // Interest: per-year annual rate, compounded per assumptions, over elapsed months.
      const yearRow = ref.interestByStateYear.get(state)?.get(periodDate.getUTCFullYear())
      const annualRate = yearRow?.annual_rate ?? 0
      const years = monthsElapsed / 12
      let interest = 0
      if (annualRate > 0 && years > 0) {
        if (a.compounding === 'none') {
          interest = tax * annualRate * years
        } else if (a.compounding === 'daily') {
          interest = tax * (Math.pow(1 + annualRate / 365, 365 * years) - 1)
        } else if (a.compounding === 'annual') {
          interest = tax * (Math.pow(1 + annualRate, years) - 1)
        } else {
          // monthly (default)
          interest = tax * (Math.pow(1 + annualRate / 12, monthsElapsed) - 1)
        }
      }

      stateTax += tax
      statePenalty += penalty
      stateInterest += interest

      await db.insert(exposure_lines).values({
        engagement_id: engagementId,
        state,
        period: k,
        taxable_sales: taxable,
        rate_applied: rate,
        tax,
        penalty,
        interest,
      })
    }

    const stateTotal = stateTax + statePenalty + stateInterest

    // --- VDA scenario for this state ---
    const lookbackYears = vda?.lookback_years ?? 4
    const waivesPenalties = vda?.waives_penalties ?? true
    const interestTreatment = vda?.interest_treatment ?? 'full'
    const cutoff = new Date(asOf)
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - lookbackYears)

    // VDA only reaches back `lookbackYears`; older periods are forgiven.
    let vdaTax = 0
    let vdaInterest = 0
    for (const [k, taxable] of taxablePeriods) {
      const periodDate = new Date(`${k}-01T00:00:00.000Z`)
      if (periodDate.getTime() < cutoff.getTime()) continue
      const tax = taxable * rate
      vdaTax += tax
      const yearRow = ref.interestByStateYear.get(state)?.get(periodDate.getUTCFullYear())
      const annualRate = yearRow?.annual_rate ?? 0
      const monthsElapsed = Math.max(0, monthsBetween(periodDate, asOf))
      const years = monthsElapsed / 12
      if (annualRate > 0 && years > 0) {
        vdaInterest += tax * annualRate * years
      }
    }
    if (interestTreatment === 'waived') vdaInterest = 0
    const vdaPenalty = waivesPenalties ? 0 : statePenalty
    const vdaTotal = vdaTax + vdaPenalty + vdaInterest
    const vdaSavings = Math.max(0, stateTotal - vdaTotal)

    // Materiality band relative to a coarse scale.
    let band = 'low'
    if (stateTotal >= 100000) band = 'high'
    else if (stateTotal >= 25000) band = 'medium'

    await db.insert(state_exposures).values({
      engagement_id: engagementId,
      state,
      tax: stateTax,
      penalty: statePenalty,
      interest: stateInterest,
      total: stateTotal,
      vda_tax: vdaTax,
      vda_total: vdaTotal,
      vda_savings: vdaSavings,
      materiality_band: band,
    })

    totalTax += stateTax
    totalPenalty += statePenalty
    totalInterest += stateInterest
    totalVdaSavings += vdaSavings

    perStateRegister.push({ state, tax: stateTax, penalty: statePenalty, interest: stateInterest, total: stateTotal })
    perStateVda.push({ state, tax: vdaTax, penalty: vdaPenalty, interest: vdaInterest, total: vdaTotal })
  }

  const totalExposure = totalTax + totalPenalty + totalInterest

  // --- Scenarios: register-now vs VDA ---
  const registerTotal = totalExposure
  const vdaTax = perStateVda.reduce((s, r) => s + r.tax, 0)
  const vdaPenalty = perStateVda.reduce((s, r) => s + r.penalty, 0)
  const vdaInterest = perStateVda.reduce((s, r) => s + r.interest, 0)
  const vdaTotal = vdaTax + vdaPenalty + vdaInterest

  const vdaRecommended = vdaTotal < registerTotal
  await db.insert(scenarios).values({
    engagement_id: engagementId,
    kind: 'register_now',
    wait_months: 0,
    total_tax: totalTax,
    total_penalty: totalPenalty,
    total_interest: totalInterest,
    total: registerTotal,
    per_state: perStateRegister,
    is_recommended: !vdaRecommended,
  })
  await db.insert(scenarios).values({
    engagement_id: engagementId,
    kind: 'vda',
    wait_months: 0,
    total_tax: vdaTax,
    total_penalty: vdaPenalty,
    total_interest: vdaInterest,
    total: vdaTotal,
    per_state: perStateVda,
    is_recommended: vdaRecommended,
  })

  const totals = {
    total_tax: totalTax,
    total_penalty: totalPenalty,
    total_interest: totalInterest,
    total_exposure: totalExposure,
    total_vda_savings: totalVdaSavings,
  }

  await db
    .update(engagements)
    .set({ ...totals, updated_at: new Date() })
    .where(eq(engagements.id, engagementId))

  return totals
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET / — list engagements (optional ?workspace_id)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')

  // Workspaces the user can see.
  const memberships = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.user_id, userId))
  const memberWorkspaces = new Set(memberships.map((m) => m.workspace_id))

  let rows = await db.select().from(engagements).orderBy(desc(engagements.updated_at))
  rows = rows.filter((e) => e.user_id === userId || memberWorkspaces.has(e.workspace_id))
  if (workspaceId) rows = rows.filter((e) => e.workspace_id === workspaceId)
  return c.json(rows)
})

// POST / — create engagement
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, body.workspace_id))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)
  if (!(await isWorkspaceMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const asOf = body.as_of_date ? new Date(body.as_of_date) : new Date()
  if (Number.isNaN(asOf.getTime())) return c.json({ error: 'Invalid as_of_date' }, 400)
  const [eng] = await db
    .insert(engagements)
    .values({
      workspace_id: body.workspace_id,
      user_id: userId,
      name: body.name,
      description: body.description,
      as_of_date: asOf,
      status: body.status,
    })
    .returning()
  await db.insert(assumptions).values({ engagement_id: eng.id })
  await logActivity(body.workspace_id, userId, 'engagement.create', eng.name)
  return c.json(eng, 201)
})

// GET /:id — engagement detail + totals
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const eng = await engagementForUser(c.req.param('id'), userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  return c.json(eng)
})

// PUT /:id — update (name/desc/as_of_date/status)
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const eng = await engagementForUser(id, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  if (eng.is_locked) return c.json({ error: 'Engagement is locked' }, 409)
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.name !== undefined) patch.name = body.name
  if (body.description !== undefined) patch.description = body.description
  if (body.status !== undefined) patch.status = body.status
  if (body.as_of_date !== undefined) {
    const d = new Date(body.as_of_date)
    if (Number.isNaN(d.getTime())) return c.json({ error: 'Invalid as_of_date' }, 400)
    patch.as_of_date = d
  }
  const [updated] = await db.update(engagements).set(patch).where(eq(engagements.id, id)).returning()
  await logActivity(eng.workspace_id, userId, 'engagement.update', updated.name)
  return c.json(updated)
})

// DELETE /:id — delete engagement + all dependent rows
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const eng = await engagementForUser(id, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  if (eng.user_id !== userId && eng.workspace_id) {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, eng.workspace_id))
    if (ws && ws.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  }
  // Remove dependent computed + child rows first (FK integrity).
  await db.delete(scenarios).where(eq(scenarios.engagement_id, id))
  await db.delete(state_exposures).where(eq(state_exposures.engagement_id, id))
  await db.delete(exposure_lines).where(eq(exposure_lines.engagement_id, id))
  await db.delete(crossing_results).where(eq(crossing_results.engagement_id, id))
  await db.delete(sales_lines).where(eq(sales_lines.engagement_id, id))
  await db.delete(assumptions).where(eq(assumptions.engagement_id, id))
  await db.delete(engagements).where(eq(engagements.id, id))
  await logActivity(eng.workspace_id, userId, 'engagement.delete', eng.name)
  return c.json({ success: true })
})

// POST /:id/clone — clone engagement + sales + assumptions
router.post('/:id/clone', authMiddleware, zValidator('json', cloneSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const eng = await engagementForUser(id, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  const body = c.req.valid('json')
  const targetWorkspace = body.workspace_id ?? eng.workspace_id
  if (!(await isWorkspaceMember(targetWorkspace, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const [clone] = await db
    .insert(engagements)
    .values({
      workspace_id: targetWorkspace,
      user_id: userId,
      name: body.name ?? `${eng.name} (copy)`,
      description: eng.description ?? '',
      as_of_date: eng.as_of_date,
      status: 'draft',
    })
    .returning()

  // Clone sales lines (drop import_job_id linkage since jobs aren't cloned).
  const lines = await db.select().from(sales_lines).where(eq(sales_lines.engagement_id, id))
  if (lines.length > 0) {
    await db.insert(sales_lines).values(
      lines.map((l) => ({
        engagement_id: clone.id,
        import_job_id: null,
        sale_date: l.sale_date,
        state: l.state,
        jurisdiction: l.jurisdiction ?? '',
        amount: l.amount,
        is_taxable: l.is_taxable,
        is_marketplace: l.is_marketplace,
        transaction_ref: l.transaction_ref ?? '',
        product_category: l.product_category ?? '',
        exempt_reason: l.exempt_reason ?? '',
      })),
    )
  }

  // Clone assumptions.
  const [srcAssumptions] = await db.select().from(assumptions).where(eq(assumptions.engagement_id, id))
  if (srcAssumptions) {
    await db.insert(assumptions).values({
      engagement_id: clone.id,
      effective_rate_basis: srcAssumptions.effective_rate_basis,
      include_marketplace_sales: srcAssumptions.include_marketplace_sales,
      include_exempt_in_measure: srcAssumptions.include_exempt_in_measure,
      compounding: srcAssumptions.compounding,
      saas_taxable_stance: srcAssumptions.saas_taxable_stance,
      notes: srcAssumptions.notes ?? '',
    })
  } else {
    await db.insert(assumptions).values({ engagement_id: clone.id })
  }

  await logActivity(targetWorkspace, userId, 'engagement.clone', clone.name)
  return c.json(clone, 201)
})

// POST /:id/lock — lock/unlock engagement
router.post('/:id/lock', authMiddleware, zValidator('json', lockSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const eng = await engagementForUser(id, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(engagements)
    .set({ is_locked: body.is_locked, updated_at: new Date() })
    .where(eq(engagements.id, id))
    .returning()
  await logActivity(eng.workspace_id, userId, body.is_locked ? 'engagement.lock' : 'engagement.unlock', eng.name)
  return c.json(updated)
})

// POST /:id/recompute — recompute crossings+exposure+scenarios+totals
router.post('/:id/recompute', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const eng = await engagementForUser(id, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  if (eng.is_locked) return c.json({ error: 'Engagement is locked' }, 409)

  const [a] = await db.select().from(assumptions).where(eq(assumptions.engagement_id, id))
  const assumptionInput: Assumptions = {
    include_marketplace_sales: a?.include_marketplace_sales ?? false,
    include_exempt_in_measure: a?.include_exempt_in_measure ?? true,
    compounding: a?.compounding ?? 'monthly',
  }
  const asOf = new Date(eng.as_of_date)
  const totals = await runPipeline(id, asOf, assumptionInput)
  await logActivity(eng.workspace_id, userId, 'engagement.recompute', eng.name)
  return c.json({ ok: true, totals })
})

export default router
