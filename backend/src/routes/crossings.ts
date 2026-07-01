import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  engagements,
  workspace_members,
  sales_lines,
  assumptions,
  state_nexus_rules,
  crossing_results,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Ownership: an engagement is accessible if the caller owns it directly or is
// a member of its workspace.
// ---------------------------------------------------------------------------

async function loadOwnedEngagement(engagementId: string, userId: string) {
  const [eng] = await db.select().from(engagements).where(eq(engagements.id, engagementId))
  if (!eng) return { engagement: null, forbidden: false }
  if (eng.user_id === userId) return { engagement: eng, forbidden: false }
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, eng.workspace_id), eq(workspace_members.user_id, userId)))
  if (member) return { engagement: eng, forbidden: false }
  return { engagement: null, forbidden: true }
}

// ---------------------------------------------------------------------------
// Crossing detection engine
// ---------------------------------------------------------------------------

type TimelinePoint = {
  period: string
  sales: number
  txns: number
  running_sales: number
  running_txns: number
}

type StateCrossing = {
  state: string
  has_crossed: boolean
  crossing_date: Date | null
  tripping_test: string | null
  measure_at_crossing: number | null
  threshold_used: number | null
  timeline: TimelinePoint[]
}

function periodKey(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/** Pick the nexus rule in effect on/before a given date for a state. */
function ruleInEffect(
  rules: Array<typeof state_nexus_rules.$inferSelect>,
  onDate: Date,
): typeof state_nexus_rules.$inferSelect | null {
  let chosen: typeof state_nexus_rules.$inferSelect | null = null
  for (const r of rules) {
    if (new Date(r.effective_date).getTime() <= onDate.getTime()) {
      if (!chosen || new Date(r.effective_date).getTime() > new Date(chosen.effective_date).getTime()) {
        chosen = r
      }
    }
  }
  // If nothing effective yet, fall back to the earliest known rule.
  if (!chosen && rules.length > 0) {
    chosen = rules.reduce((a, b) =>
      new Date(a.effective_date).getTime() <= new Date(b.effective_date).getTime() ? a : b,
    )
  }
  return chosen
}

/**
 * Detect the retroactive economic-nexus crossing for every state present in the
 * engagement's sales. Uses the engagement's assumptions to decide whether
 * marketplace and exempt sales count toward the measure, and each state's nexus
 * rule (sales_threshold / transaction_threshold / rolling window) to find the
 * first period where a threshold was tripped.
 */
async function detectCrossings(engagementId: string): Promise<StateCrossing[]> {
  const [asm] = await db.select().from(assumptions).where(eq(assumptions.engagement_id, engagementId))
  const includeMarketplace = asm ? asm.include_marketplace_sales : false
  const includeExempt = asm ? asm.include_exempt_in_measure : true

  const lines = await db.select().from(sales_lines).where(eq(sales_lines.engagement_id, engagementId))

  const allRules = await db.select().from(state_nexus_rules)
  const rulesByState = new Map<string, Array<typeof state_nexus_rules.$inferSelect>>()
  for (const r of allRules) {
    const arr = rulesByState.get(r.state) ?? []
    arr.push(r)
    rulesByState.set(r.state, arr)
  }

  // Group sales by state -> period, tracking measured (counting) sales + txns.
  type Bucket = { measured: number; txns: number }
  const byState = new Map<string, Map<string, Bucket>>()

  for (const l of lines) {
    // Respect assumption toggles for what counts toward the nexus measure.
    if (l.is_marketplace && !includeMarketplace) continue
    if (!l.is_taxable && !includeExempt) continue
    const state = l.state.toUpperCase()
    const period = periodKey(new Date(l.sale_date))
    let periods = byState.get(state)
    if (!periods) {
      periods = new Map()
      byState.set(state, periods)
    }
    const b = periods.get(period) ?? { measured: 0, txns: 0 }
    b.measured += l.amount
    b.txns += 1
    periods.set(period, b)
  }

  const results: StateCrossing[] = []

  for (const [state, periods] of byState) {
    const rules = rulesByState.get(state) ?? []
    const sortedPeriods = [...periods.keys()].sort()

    // Determine measurement window (in months) from the state's rule; default rolling 12.
    const anyRule = rules[0]
    let windowMonths = 12
    if (anyRule) {
      const mp = anyRule.measurement_period
      if (mp === 'calendar_year' || mp === 'prior_calendar_year') windowMonths = 12
      else if (/^rolling_(\d+)$/.test(mp)) windowMonths = parseInt(mp.replace('rolling_', ''), 10) || 12
    }

    const timeline: TimelinePoint[] = []
    let crossed = false
    let crossingDate: Date | null = null
    let trippingTest: string | null = null
    let measureAtCrossing: number | null = null
    let thresholdUsed: number | null = null

    // Rolling running totals over the trailing `windowMonths` window.
    const monthList = sortedPeriods
    for (let i = 0; i < monthList.length; i++) {
      const period = monthList[i]
      const bucket = periods.get(period)!
      // Rolling window: sum measured sales/txns over the trailing window ending at this period.
      let runningSales = 0
      let runningTxns = 0
      const [py, pm] = period.split('-').map((n) => parseInt(n, 10))
      const windowStartIdx = py * 12 + (pm - 1) - (windowMonths - 1)
      for (let j = 0; j <= i; j++) {
        const [jy, jm] = monthList[j].split('-').map((n) => parseInt(n, 10))
        const jIdx = jy * 12 + (jm - 1)
        if (jIdx >= windowStartIdx) {
          const jb = periods.get(monthList[j])!
          runningSales += jb.measured
          runningTxns += jb.txns
        }
      }

      timeline.push({
        period,
        sales: Math.round(bucket.measured * 100) / 100,
        txns: bucket.txns,
        running_sales: Math.round(runningSales * 100) / 100,
        running_txns: runningTxns,
      })

      if (!crossed) {
        const periodDate = new Date(Date.UTC(py, pm - 1, 1))
        const rule = ruleInEffect(rules, periodDate)
        if (rule) {
          const salesTrip = runningSales >= rule.sales_threshold
          const txnTrip = rule.transaction_threshold != null && runningTxns >= rule.transaction_threshold
          if (salesTrip || txnTrip) {
            crossed = true
            // Crossing recognized at the end of the tripping period.
            crossingDate = new Date(Date.UTC(py, pm, 0)) // last day of the period month
            if (salesTrip && txnTrip) {
              trippingTest = 'both'
              measureAtCrossing = runningSales
              thresholdUsed = rule.sales_threshold
            } else if (salesTrip) {
              trippingTest = 'sales'
              measureAtCrossing = runningSales
              thresholdUsed = rule.sales_threshold
            } else {
              trippingTest = 'transactions'
              measureAtCrossing = runningTxns
              thresholdUsed = rule.transaction_threshold
            }
          }
        }
      }
    }

    results.push({
      state,
      has_crossed: crossed,
      crossing_date: crossingDate,
      tripping_test: trippingTest,
      measure_at_crossing: measureAtCrossing != null ? Math.round(measureAtCrossing * 100) / 100 : null,
      threshold_used: thresholdUsed,
      timeline,
    })
  }

  results.sort((a, b) => a.state.localeCompare(b.state))
  return results
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Per-state crossing results for an engagement.
router.get('/:engagementId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { engagement, forbidden } = await loadOwnedEngagement(engagementId, userId)
  if (forbidden) return c.json({ error: 'Forbidden' }, 403)
  if (!engagement) return c.json({ error: 'Not found' }, 404)
  const rows = await db
    .select()
    .from(crossing_results)
    .where(eq(crossing_results.engagement_id, engagementId))
    .orderBy(crossing_results.state)
  return c.json(rows)
})

// One state's crossing result + timeline.
router.get('/:engagementId/:state', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const state = c.req.param('state').toUpperCase()
  const { engagement, forbidden } = await loadOwnedEngagement(engagementId, userId)
  if (forbidden) return c.json({ error: 'Forbidden' }, 403)
  if (!engagement) return c.json({ error: 'Not found' }, 404)
  const [row] = await db
    .select()
    .from(crossing_results)
    .where(and(eq(crossing_results.engagement_id, engagementId), eq(crossing_results.state, state)))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// Run crossing detection, persist per-state results (upsert on engagement+state).
router.post('/:engagementId/detect', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { engagement, forbidden } = await loadOwnedEngagement(engagementId, userId)
  if (forbidden) return c.json({ error: 'Forbidden' }, 403)
  if (!engagement) return c.json({ error: 'Not found' }, 404)
  if (engagement.is_locked) return c.json({ error: 'Engagement is locked' }, 409)

  const detected = await detectCrossings(engagementId)
  const now = new Date()

  const persisted: Array<typeof crossing_results.$inferSelect> = []
  for (const d of detected) {
    const [row] = await db
      .insert(crossing_results)
      .values({
        engagement_id: engagementId,
        state: d.state,
        has_crossed: d.has_crossed,
        crossing_date: d.crossing_date,
        tripping_test: d.tripping_test,
        measure_at_crossing: d.measure_at_crossing,
        threshold_used: d.threshold_used,
        timeline: d.timeline,
        computed_at: now,
      })
      .onConflictDoUpdate({
        target: [crossing_results.engagement_id, crossing_results.state],
        set: {
          has_crossed: d.has_crossed,
          crossing_date: d.crossing_date,
          tripping_test: d.tripping_test,
          measure_at_crossing: d.measure_at_crossing,
          threshold_used: d.threshold_used,
          timeline: d.timeline,
          computed_at: now,
        },
      })
      .returning()
    persisted.push(row)
  }

  return c.json({ ok: true, crossings: persisted })
})

export default router
