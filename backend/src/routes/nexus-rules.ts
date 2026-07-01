import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { state_nexus_rules } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Admin gating: user must be listed in ADMIN_USER_IDS
// ---------------------------------------------------------------------------
const ADMIN_IDS = () => (process.env.ADMIN_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean)

const adminMiddleware = async (c: any, next: () => Promise<void>) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!ADMIN_IDS().includes(userId)) return c.json({ error: 'Forbidden' }, 403)
  await next()
}

const ruleSchema = z.object({
  state: z.string().min(2).max(2),
  sales_threshold: z.number().nonnegative(),
  transaction_threshold: z.number().int().nonnegative().nullable().optional(),
  measurement_period: z.string().min(1).optional().default('rolling_12'),
  counts_marketplace: z.boolean().optional().default(true),
  includes_exempt: z.boolean().optional().default(true),
  effective_date: z.string().min(1),
  citation: z.string().optional().default(''),
  notes: z.string().optional().default(''),
})

// GET / — list all state nexus rules (public)
router.get('/', async (c) => {
  const rows = await db
    .select()
    .from(state_nexus_rules)
    .orderBy(state_nexus_rules.state, desc(state_nexus_rules.effective_date))
  return c.json(rows)
})

// GET /:state — latest rule for a state (public)
router.get('/:state', async (c) => {
  const state = c.req.param('state').toUpperCase()
  const [rule] = await db
    .select()
    .from(state_nexus_rules)
    .where(eq(state_nexus_rules.state, state))
    .orderBy(desc(state_nexus_rules.effective_date))
    .limit(1)
  if (!rule) return c.json({ error: 'No rule for state' }, 404)
  return c.json(rule)
})

// POST / — create / version a rule (admin)
router.post('/', authMiddleware, adminMiddleware, zValidator('json', ruleSchema), async (c) => {
  const body = c.req.valid('json')
  const state = body.state.toUpperCase()
  const effectiveDate = new Date(body.effective_date)
  if (Number.isNaN(effectiveDate.getTime())) return c.json({ error: 'Invalid effective_date' }, 400)

  // Enforce UNIQUE(state, effective_date): a version at this date must not exist.
  const [existing] = await db
    .select()
    .from(state_nexus_rules)
    .where(and(eq(state_nexus_rules.state, state), eq(state_nexus_rules.effective_date, effectiveDate)))
  if (existing) return c.json({ error: 'A rule version already exists for this state and effective_date' }, 409)

  const [rule] = await db
    .insert(state_nexus_rules)
    .values({
      state,
      sales_threshold: body.sales_threshold,
      transaction_threshold: body.transaction_threshold ?? null,
      measurement_period: body.measurement_period,
      counts_marketplace: body.counts_marketplace,
      includes_exempt: body.includes_exempt,
      effective_date: effectiveDate,
      citation: body.citation,
      notes: body.notes,
    })
    .returning()
  return c.json(rule, 201)
})

// PUT /:id — update a rule (admin)
router.put('/:id', authMiddleware, adminMiddleware, zValidator('json', ruleSchema.partial()), async (c) => {
  const id = c.req.param('id')
  const [existing] = await db.select().from(state_nexus_rules).where(eq(state_nexus_rules.id, id))
  if (!existing) return c.json({ error: 'Rule not found' }, 404)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.state !== undefined) patch.state = body.state.toUpperCase()
  if (body.sales_threshold !== undefined) patch.sales_threshold = body.sales_threshold
  if (body.transaction_threshold !== undefined) patch.transaction_threshold = body.transaction_threshold
  if (body.measurement_period !== undefined) patch.measurement_period = body.measurement_period
  if (body.counts_marketplace !== undefined) patch.counts_marketplace = body.counts_marketplace
  if (body.includes_exempt !== undefined) patch.includes_exempt = body.includes_exempt
  if (body.effective_date !== undefined) {
    const d = new Date(body.effective_date)
    if (Number.isNaN(d.getTime())) return c.json({ error: 'Invalid effective_date' }, 400)
    patch.effective_date = d
  }
  if (body.citation !== undefined) patch.citation = body.citation
  if (body.notes !== undefined) patch.notes = body.notes

  if (Object.keys(patch).length === 0) return c.json(existing)

  const [updated] = await db
    .update(state_nexus_rules)
    .set(patch)
    .where(eq(state_nexus_rules.id, id))
    .returning()
  return c.json(updated)
})

export default router
