import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { state_penalty_rules } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Admin gating
// ---------------------------------------------------------------------------

const ADMIN_IDS = () => (process.env.ADMIN_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean)

const adminMiddleware = async (c: any, next: any) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  if (!ADMIN_IDS().includes(userId)) return c.json({ error: 'Forbidden: admin only' }, 403)
  await next()
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const penaltyRuleSchema = z.object({
  state: z.string().min(1).max(64),
  failure_to_file_rate: z.number().min(0),
  failure_to_pay_rate: z.number().min(0),
  penalty_cap_rate: z.number().min(0).nullable().optional(),
  min_penalty: z.number().min(0).optional().default(0),
  accrual: z.string().min(1).optional().default('monthly'),
  effective_date: z.string().min(1),
  notes: z.string().optional().default(''),
})

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------

// List all state penalty rules (newest effective first)
router.get('/', async (c) => {
  const rows = await db
    .select()
    .from(state_penalty_rules)
    .orderBy(state_penalty_rules.state, desc(state_penalty_rules.effective_date))
  return c.json(rows)
})

// Latest penalty rule for a given state
router.get('/:state', async (c) => {
  const state = c.req.param('state')
  const [row] = await db
    .select()
    .from(state_penalty_rules)
    .where(eq(state_penalty_rules.state, state))
    .orderBy(desc(state_penalty_rules.effective_date))
    .limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// ---------------------------------------------------------------------------
// Admin writes (create/version + update)
// ---------------------------------------------------------------------------

// Create / version a penalty rule for a state+effective_date
router.post('/', adminMiddleware, zValidator('json', penaltyRuleSchema), async (c) => {
  const body = c.req.valid('json')
  const effective = new Date(body.effective_date)
  if (Number.isNaN(effective.getTime())) return c.json({ error: 'Invalid effective_date' }, 400)

  const [dup] = await db
    .select()
    .from(state_penalty_rules)
    .where(and(eq(state_penalty_rules.state, body.state), eq(state_penalty_rules.effective_date, effective)))
    .limit(1)
  if (dup) return c.json({ error: 'A penalty rule already exists for this state and effective date' }, 409)

  const [created] = await db
    .insert(state_penalty_rules)
    .values({
      state: body.state,
      failure_to_file_rate: body.failure_to_file_rate,
      failure_to_pay_rate: body.failure_to_pay_rate,
      penalty_cap_rate: body.penalty_cap_rate ?? null,
      min_penalty: body.min_penalty,
      accrual: body.accrual,
      effective_date: effective,
      notes: body.notes,
    })
    .returning()
  return c.json(created, 201)
})

// Update an existing penalty rule by id
router.put('/:id', adminMiddleware, zValidator('json', penaltyRuleSchema.partial()), async (c) => {
  const id = c.req.param('id')
  const [existing] = await db.select().from(state_penalty_rules).where(eq(state_penalty_rules.id, id)).limit(1)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.state !== undefined) patch.state = body.state
  if (body.failure_to_file_rate !== undefined) patch.failure_to_file_rate = body.failure_to_file_rate
  if (body.failure_to_pay_rate !== undefined) patch.failure_to_pay_rate = body.failure_to_pay_rate
  if (body.penalty_cap_rate !== undefined) patch.penalty_cap_rate = body.penalty_cap_rate
  if (body.min_penalty !== undefined) patch.min_penalty = body.min_penalty
  if (body.accrual !== undefined) patch.accrual = body.accrual
  if (body.notes !== undefined) patch.notes = body.notes
  if (body.effective_date !== undefined) {
    const effective = new Date(body.effective_date)
    if (Number.isNaN(effective.getTime())) return c.json({ error: 'Invalid effective_date' }, 400)
    patch.effective_date = effective
  }

  const [updated] = await db.update(state_penalty_rules).set(patch).where(eq(state_penalty_rules.id, id)).returning()
  return c.json(updated)
})

export default router
