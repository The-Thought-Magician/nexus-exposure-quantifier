import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { engagements, workspace_members, scenarios } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { computeExposureForEngagement, type ComputedState } from './exposure.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Ownership helper
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
// Scenario projection
// ---------------------------------------------------------------------------

interface ScenarioResult {
  kind: 'register_now' | 'vda' | 'wait'
  wait_months: number
  total_tax: number
  total_penalty: number
  total_interest: number
  total: number
  per_state: Array<{ state: string; tax: number; penalty: number; interest: number; total: number }>
}

function rollupPerState(
  states: ComputedState[],
  pick: (s: ComputedState) => { tax: number; penalty: number; interest: number; total: number },
): ScenarioResult['per_state'] {
  return states.map((s) => {
    const p = pick(s)
    return { state: s.state, tax: p.tax, penalty: p.penalty, interest: p.interest, total: p.total }
  })
}

function sum(per: ScenarioResult['per_state']) {
  return per.reduce(
    (acc, p) => {
      acc.tax += p.tax
      acc.penalty += p.penalty
      acc.interest += p.interest
      acc.total += p.total
      return acc
    },
    { tax: 0, penalty: 0, interest: 0, total: 0 },
  )
}

/** Build the three canonical scenarios from computed exposure at as-of and at as-of + waitMonths. */
async function buildScenarios(engagementId: string, asOf: Date, waitMonths: number): Promise<ScenarioResult[]> {
  const now = await computeExposureForEngagement(engagementId, asOf)

  // Register-now: full exposure (tax + penalty + interest), no VDA relief.
  const regPer = rollupPerState(now.states, (s) => ({
    tax: s.tax,
    penalty: s.penalty,
    interest: s.interest,
    total: s.total,
  }))
  const regSum = sum(regPer)
  const registerNow: ScenarioResult = {
    kind: 'register_now',
    wait_months: 0,
    total_tax: regSum.tax,
    total_penalty: regSum.penalty,
    total_interest: regSum.interest,
    total: regSum.total,
    per_state: regPer,
  }

  // VDA: lookback-limited tax, penalties typically waived; the remainder of the
  // VDA total over tax is treated as (reduced) interest.
  const vdaPer = rollupPerState(now.states, (s) => ({
    tax: s.vda_tax,
    penalty: 0,
    interest: Math.max(0, s.vda_total - s.vda_tax),
    total: s.vda_total,
  }))
  const vdaSum = sum(vdaPer)
  const vda: ScenarioResult = {
    kind: 'vda',
    wait_months: 0,
    total_tax: vdaSum.tax,
    total_penalty: vdaSum.penalty,
    total_interest: vdaSum.interest,
    total: vdaSum.total,
    per_state: vdaPer,
  }

  // Wait: project full exposure forward by waitMonths (more penalty + interest accrual).
  const future = new Date(asOf)
  future.setUTCMonth(future.getUTCMonth() + waitMonths)
  const later = await computeExposureForEngagement(engagementId, future)
  const waitPer = rollupPerState(later.states, (s) => ({
    tax: s.tax,
    penalty: s.penalty,
    interest: s.interest,
    total: s.total,
  }))
  const waitSum = sum(waitPer)
  const wait: ScenarioResult = {
    kind: 'wait',
    wait_months: waitMonths,
    total_tax: waitSum.tax,
    total_penalty: waitSum.penalty,
    total_interest: waitSum.interest,
    total: waitSum.total,
    per_state: waitPer,
  }

  return [registerNow, vda, wait]
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /:engagementId — list computed scenarios (latest per kind first).
router.get('/:engagementId', authMiddleware, async (c) => {
  const engagementId = c.req.param('engagementId')
  const userId = getUserId(c)
  const { eng, allowed } = await loadEngagementForUser(engagementId, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select()
    .from(scenarios)
    .where(eq(scenarios.engagement_id, engagementId))
    .orderBy(desc(scenarios.computed_at))
  return c.json(rows)
})

// POST /:engagementId/compute — compute register/VDA/wait, mark recommended.
const computeSchema = z
  .object({
    wait_months: z.number().int().min(1).max(60).optional(),
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

  const body = c.req.valid('json') as { wait_months?: number; as_of_date?: string } | undefined
  const qWait = Number(c.req.query('wait_months'))
  const waitMonths = body?.wait_months ?? (Number.isFinite(qWait) && qWait > 0 ? qWait : 12)
  const asOf = body?.as_of_date ? new Date(body.as_of_date) : new Date(eng.as_of_date)

  const results = await buildScenarios(engagementId, asOf, waitMonths)

  // Recommendation: lowest total cost of action wins (register-now vs VDA);
  // "wait" is never recommended when it costs more than acting now.
  const actionable = results.filter((r) => r.kind !== 'wait')
  const cheapest = actionable.reduce((best, r) => (r.total < best.total ? r : best), actionable[0])
  const now = new Date()

  // Replace prior scenarios for this engagement.
  await db.delete(scenarios).where(eq(scenarios.engagement_id, engagementId))

  const inserted: Array<typeof scenarios.$inferSelect> = []
  for (const r of results) {
    const isRecommended = cheapest ? r.kind === cheapest.kind : false
    const [row] = await db
      .insert(scenarios)
      .values({
        engagement_id: engagementId,
        kind: r.kind,
        wait_months: r.wait_months,
        total_tax: r.total_tax,
        total_penalty: r.total_penalty,
        total_interest: r.total_interest,
        total: r.total,
        per_state: r.per_state,
        is_recommended: isRecommended,
        computed_at: now,
      })
      .returning()
    inserted.push(row)
  }

  inserted.sort((a, b) => (a.total ?? 0) - (b.total ?? 0))
  return c.json(inserted)
})

export default router
