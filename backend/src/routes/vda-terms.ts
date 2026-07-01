import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { state_vda_terms } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const ADMIN_IDS = () => (process.env.ADMIN_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean)

const adminMiddleware = async (c: any, next: () => Promise<void>) => {
  const userId = getUserId(c)
  if (!ADMIN_IDS().includes(userId)) return c.json({ error: 'Forbidden' }, 403)
  await next()
}

const vdaTermSchema = z.object({
  state: z.string().min(2).max(2),
  lookback_years: z.number().int().min(0).max(20).default(4),
  waives_penalties: z.boolean().default(true),
  interest_treatment: z.enum(['full', 'waived', 'reduced']).default('full'),
  requires_no_prior_contact: z.boolean().default(true),
  notes: z.string().optional().default(''),
})

// Public: list all VDA terms (by state)
router.get('/', async (c) => {
  const rows = await db.select().from(state_vda_terms).orderBy(state_vda_terms.state)
  return c.json(rows)
})

// Public: VDA terms for a single state
router.get('/:state', async (c) => {
  const state = c.req.param('state').toUpperCase()
  const [row] = await db.select().from(state_vda_terms).where(eq(state_vda_terms.state, state))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// Admin: create/update VDA terms (upsert on state UNIQUE)
router.post('/', authMiddleware, adminMiddleware, zValidator('json', vdaTermSchema), async (c) => {
  const body = c.req.valid('json')
  const state = body.state.toUpperCase()
  const [row] = await db
    .insert(state_vda_terms)
    .values({
      state,
      lookback_years: body.lookback_years,
      waives_penalties: body.waives_penalties,
      interest_treatment: body.interest_treatment,
      requires_no_prior_contact: body.requires_no_prior_contact,
      notes: body.notes,
    })
    .onConflictDoUpdate({
      target: state_vda_terms.state,
      set: {
        lookback_years: body.lookback_years,
        waives_penalties: body.waives_penalties,
        interest_treatment: body.interest_treatment,
        requires_no_prior_contact: body.requires_no_prior_contact,
        notes: body.notes,
      },
    })
    .returning()
  return c.json(row, 201)
})

// Admin: update VDA terms by id
router.put('/:id', authMiddleware, adminMiddleware, zValidator('json', vdaTermSchema.partial()), async (c) => {
  const id = c.req.param('id')
  const [existing] = await db.select().from(state_vda_terms).where(eq(state_vda_terms.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.state !== undefined) patch.state = body.state.toUpperCase()
  if (body.lookback_years !== undefined) patch.lookback_years = body.lookback_years
  if (body.waives_penalties !== undefined) patch.waives_penalties = body.waives_penalties
  if (body.interest_treatment !== undefined) patch.interest_treatment = body.interest_treatment
  if (body.requires_no_prior_contact !== undefined) patch.requires_no_prior_contact = body.requires_no_prior_contact
  if (body.notes !== undefined) patch.notes = body.notes
  const [updated] = await db.update(state_vda_terms).set(patch).where(eq(state_vda_terms.id, id)).returning()
  return c.json(updated)
})

export default router
