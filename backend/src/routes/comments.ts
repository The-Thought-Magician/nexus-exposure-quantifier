import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { engagements, workspace_members, comments } from '../db/schema.js'
import { eq, and, asc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

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

const commentSchema = z.object({
  body: z.string().min(1).max(10000),
  state: z.string().max(64).optional(),
  parent_id: z.string().optional(),
})

// ---------------------------------------------------------------------------
// GET /:engagementId — threaded comments on the engagement (optional ?state).
// Returns a flat, chronologically-ordered list plus a nested tree so the
// frontend can render either. Requires engagement access.
// ---------------------------------------------------------------------------
router.get('/:engagementId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const state = c.req.query('state')
  const where = state
    ? and(eq(comments.engagement_id, engagementId), eq(comments.state, state))
    : eq(comments.engagement_id, engagementId)

  const rows = await db.select().from(comments).where(where).orderBy(asc(comments.created_at))

  // Build a nested thread tree from parent_id links.
  type Node = (typeof rows)[number] & { replies: Node[] }
  const byId = new Map<string, Node>()
  for (const r of rows) byId.set(r.id, { ...r, replies: [] })
  const roots: Node[] = []
  for (const r of rows) {
    const node = byId.get(r.id)!
    if (r.parent_id && byId.has(r.parent_id)) {
      byId.get(r.parent_id)!.replies.push(node)
    } else {
      roots.push(node)
    }
  }

  return c.json({ comments: rows, thread: roots })
})

// ---------------------------------------------------------------------------
// POST /:engagementId — add a comment (optional parent_id for a reply, optional
// state to scope it to a jurisdiction). Requires engagement access.
// ---------------------------------------------------------------------------
router.post('/:engagementId', authMiddleware, zValidator('json', commentSchema), async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')

  // If a parent is supplied it must belong to the same engagement.
  if (body.parent_id) {
    const [parent] = await db.select().from(comments).where(eq(comments.id, body.parent_id))
    if (!parent || parent.engagement_id !== engagementId) {
      return c.json({ error: 'Parent comment not found in this engagement' }, 400)
    }
  }

  const [created] = await db
    .insert(comments)
    .values({
      engagement_id: engagementId,
      user_id: userId,
      state: body.state ?? '',
      parent_id: body.parent_id ?? null,
      body: body.body,
    })
    .returning()

  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// DELETE /:engagementId/:id — delete own comment. Only the author may delete;
// direct replies are re-parented to the deleted comment's parent so the thread
// does not orphan.
// ---------------------------------------------------------------------------
router.delete('/:engagementId/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const id = c.req.param('id')

  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const [existing] = await db.select().from(comments).where(eq(comments.id, id))
  if (!existing || existing.engagement_id !== engagementId) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  // Re-parent any direct replies to the deleted comment's parent.
  await db
    .update(comments)
    .set({ parent_id: existing.parent_id ?? null })
    .where(eq(comments.parent_id, id))

  await db.delete(comments).where(eq(comments.id, id))
  return c.json({ success: true })
})

export default router
