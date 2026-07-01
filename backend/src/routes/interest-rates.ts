import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { state_interest_rates } from '../db/schema.js'
import { eq, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const ADMIN_IDS = () => (process.env.ADMIN_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean)

const adminMiddleware = async (c: any, next: () => Promise<void>) => {
  const userId = getUserId(c)
  if (!ADMIN_IDS().includes(userId)) return c.json({ error: 'Forbidden' }, 403)
  await next()
}

const interestRateSchema = z.object({
  state: z.string().min(2).max(2),
  year: z.number().int().min(1990).max(2100),
  annual_rate: z.number().min(0).max(1),
  compounding: z.enum(['daily', 'monthly', 'quarterly', 'annual', 'simple']).default('monthly'),
  notes: z.string().optional().default(''),
})

// Public: list all interest rates (state, then year desc)
router.get('/', async (c) => {
  const rows = await db
    .select()
    .from(state_interest_rates)
    .orderBy(state_interest_rates.state, desc(state_interest_rates.year))
  return c.json(rows)
})

// Public: interest rates for a state, by year desc
router.get('/:state', async (c) => {
  const state = c.req.param('state').toUpperCase()
  const rows = await db
    .select()
    .from(state_interest_rates)
    .where(eq(state_interest_rates.state, state))
    .orderBy(desc(state_interest_rates.year))
  return c.json(rows)
})

// Admin: create an interest rate (upsert on (state, year))
router.post('/', authMiddleware, adminMiddleware, zValidator('json', interestRateSchema), async (c) => {
  const body = c.req.valid('json')
  const state = body.state.toUpperCase()
  const [row] = await db
    .insert(state_interest_rates)
    .values({
      state,
      year: body.year,
      annual_rate: body.annual_rate,
      compounding: body.compounding,
      notes: body.notes,
    })
    .onConflictDoUpdate({
      target: [state_interest_rates.state, state_interest_rates.year],
      set: {
        annual_rate: body.annual_rate,
        compounding: body.compounding,
        notes: body.notes,
      },
    })
    .returning()
  return c.json(row, 201)
})

// Admin: update an interest rate by id
router.put('/:id', authMiddleware, adminMiddleware, zValidator('json', interestRateSchema.partial()), async (c) => {
  const id = c.req.param('id')
  const [existing] = await db.select().from(state_interest_rates).where(eq(state_interest_rates.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.state !== undefined) patch.state = body.state.toUpperCase()
  if (body.year !== undefined) patch.year = body.year
  if (body.annual_rate !== undefined) patch.annual_rate = body.annual_rate
  if (body.compounding !== undefined) patch.compounding = body.compounding
  if (body.notes !== undefined) patch.notes = body.notes
  const [updated] = await db
    .update(state_interest_rates)
    .set(patch)
    .where(eq(state_interest_rates.id, id))
    .returning()
  return c.json(updated)
})

export default router
