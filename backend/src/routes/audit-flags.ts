import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { engagements, workspace_members, audit_flags } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const VDA_WINDOWS = ['open', 'narrowing', 'closed'] as const

async function loadOwnedEngagement(engagementId: string, userId: string) {
  const [eng] = await db.select().from(engagements).where(eq(engagements.id, engagementId))
  if (!eng) return { eng: null, allowed: false }
  if (eng.user_id === userId) return { eng, allowed: true }
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, eng.workspace_id), eq(workspace_members.user_id, userId)))
  return { eng, allowed: !!member }
}

// ---------------------------------------------------------------------------
// GET /:engagementId — audit-risk / VDA-window flags per state
// ---------------------------------------------------------------------------
router.get('/:engagementId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select()
    .from(audit_flags)
    .where(eq(audit_flags.engagement_id, engagementId))
    .orderBy(desc(audit_flags.updated_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /:engagementId — upsert an audit flag (vda_window, prior contact)
// ---------------------------------------------------------------------------
const upsertSchema = z.object({
  state: z.string().min(2).max(2),
  vda_window: z.enum(VDA_WINDOWS).optional(),
  has_prior_contact: z.boolean().optional(),
  notes: z.string().optional(),
})

router.post('/:engagementId', authMiddleware, zValidator('json', upsertSchema), async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const body = c.req.valid('json')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const state = body.state.toUpperCase()
  const setFields: Record<string, unknown> = { updated_at: new Date() }
  if (body.vda_window !== undefined) setFields.vda_window = body.vda_window
  if (body.has_prior_contact !== undefined) setFields.has_prior_contact = body.has_prior_contact
  if (body.notes !== undefined) setFields.notes = body.notes

  const [flag] = await db
    .insert(audit_flags)
    .values({
      engagement_id: engagementId,
      user_id: userId,
      state,
      vda_window: body.vda_window ?? 'open',
      has_prior_contact: body.has_prior_contact ?? false,
      notes: body.notes ?? '',
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [audit_flags.engagement_id, audit_flags.state],
      set: setFields,
    })
    .returning()

  return c.json(flag, 201)
})

export default router
