import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { state_tax_rates } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

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

const taxRateSchema = z.object({
  state: z.string().min(1).max(64),
  base_rate: z.number().min(0),
  avg_combined_rate: z.number().min(0),
  effective_date: z.string().min(1),
  filing_frequency: z.string().min(1).optional().default('monthly'),
  notes: z.string().optional().default(''),
})

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------

// List all state tax rates (newest effective first)
router.get('/', async (c) => {
  const rows = await db
    .select()
    .from(state_tax_rates)
    .orderBy(state_tax_rates.state, desc(state_tax_rates.effective_date))
  return c.json(rows)
})

// Latest rate for a given state
router.get('/:state', async (c) => {
  const state = c.req.param('state')
  const [row] = await db
    .select()
    .from(state_tax_rates)
    .where(eq(state_tax_rates.state, state))
    .orderBy(desc(state_tax_rates.effective_date))
    .limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// ---------------------------------------------------------------------------
// Admin writes (create/version + update)
// ---------------------------------------------------------------------------

// Create / version a rate for a state+effective_date
router.post('/', adminMiddleware, zValidator('json', taxRateSchema), async (c) => {
  const body = c.req.valid('json')
  const effective = new Date(body.effective_date)
  if (Number.isNaN(effective.getTime())) return c.json({ error: 'Invalid effective_date' }, 400)

  // Reject a duplicate version for the same (state, effective_date).
  const [dup] = await db
    .select()
    .from(state_tax_rates)
    .where(and(eq(state_tax_rates.state, body.state), eq(state_tax_rates.effective_date, effective)))
    .limit(1)
  if (dup) return c.json({ error: 'A rate already exists for this state and effective date' }, 409)

  const [created] = await db
    .insert(state_tax_rates)
    .values({
      state: body.state,
      base_rate: body.base_rate,
      avg_combined_rate: body.avg_combined_rate,
      effective_date: effective,
      filing_frequency: body.filing_frequency,
      notes: body.notes,
    })
    .returning()
  return c.json(created, 201)
})

// Update an existing rate by id
router.put('/:id', adminMiddleware, zValidator('json', taxRateSchema.partial()), async (c) => {
  const id = c.req.param('id')
  const [existing] = await db.select().from(state_tax_rates).where(eq(state_tax_rates.id, id)).limit(1)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.state !== undefined) patch.state = body.state
  if (body.base_rate !== undefined) patch.base_rate = body.base_rate
  if (body.avg_combined_rate !== undefined) patch.avg_combined_rate = body.avg_combined_rate
  if (body.filing_frequency !== undefined) patch.filing_frequency = body.filing_frequency
  if (body.notes !== undefined) patch.notes = body.notes
  if (body.effective_date !== undefined) {
    const effective = new Date(body.effective_date)
    if (Number.isNaN(effective.getTime())) return c.json({ error: 'Invalid effective_date' }, 400)
    patch.effective_date = effective
  }

  const [updated] = await db.update(state_tax_rates).set(patch).where(eq(state_tax_rates.id, id)).returning()
  return c.json(updated)
})

export default router
