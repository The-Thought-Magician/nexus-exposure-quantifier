import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { product_taxability, engagements, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Ownership: the engagement's user_id matches, or the user is a member of the
// engagement's workspace.
// ---------------------------------------------------------------------------

async function loadOwnedEngagement(engagementId: string, userId: string) {
  const [eng] = await db.select().from(engagements).where(eq(engagements.id, engagementId)).limit(1)
  if (!eng) return { engagement: null, allowed: false }
  if (eng.user_id === userId) return { engagement: eng, allowed: true }
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, eng.workspace_id), eq(workspace_members.user_id, userId)))
    .limit(1)
  return { engagement: eng, allowed: !!member }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const taxabilitySchema = z.object({
  state: z.string().min(1).max(64),
  product_category: z.string().min(1).max(128),
  is_taxable: z.boolean().optional().default(true),
  rate_override: z.number().min(0).nullable().optional(),
})

// ---------------------------------------------------------------------------
// List — auth-gated read of one engagement's taxability matrix
// ---------------------------------------------------------------------------

router.get('/:engagementId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { engagement, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!engagement) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select()
    .from(product_taxability)
    .where(eq(product_taxability.engagement_id, engagementId))
    .orderBy(product_taxability.state, desc(product_taxability.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// Upsert a taxability row (unique on engagement_id, state, product_category)
// ---------------------------------------------------------------------------

router.post('/:engagementId', authMiddleware, zValidator('json', taxabilitySchema), async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { engagement, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!engagement) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)
  if (engagement.is_locked) return c.json({ error: 'Engagement is locked' }, 409)

  const body = c.req.valid('json')
  const [row] = await db
    .insert(product_taxability)
    .values({
      engagement_id: engagementId,
      state: body.state,
      product_category: body.product_category,
      is_taxable: body.is_taxable,
      rate_override: body.rate_override ?? null,
    })
    .onConflictDoUpdate({
      target: [product_taxability.engagement_id, product_taxability.state, product_taxability.product_category],
      set: {
        is_taxable: body.is_taxable,
        rate_override: body.rate_override ?? null,
      },
    })
    .returning()
  return c.json(row, 201)
})

// ---------------------------------------------------------------------------
// Delete a taxability row (scoped to the engagement)
// ---------------------------------------------------------------------------

router.delete('/:engagementId/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const id = c.req.param('id')
  const { engagement, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!engagement) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)
  if (engagement.is_locked) return c.json({ error: 'Engagement is locked' }, 409)

  const [existing] = await db
    .select()
    .from(product_taxability)
    .where(and(eq(product_taxability.id, id), eq(product_taxability.engagement_id, engagementId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  await db.delete(product_taxability).where(eq(product_taxability.id, id))
  return c.json({ success: true })
})

export default router
