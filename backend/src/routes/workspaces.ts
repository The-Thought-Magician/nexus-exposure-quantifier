import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  workspaces,
  workspace_members,
  engagements,
  activity_log,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Accepts undefined, null, or empty string as "not provided" — the create/edit
// dialog shows these fields as optional (placeholder-only, not required), so
// omitting them or sending "" / null must not fail validation.
const optionalTrimmedString = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v === null || v === undefined || v === '' ? undefined : v))

const workspaceCreateSchema = z.object({
  name: z.string().min(1),
  legal_name: optionalTrimmedString,
  fiscal_year_end: optionalTrimmedString,
})

const workspaceUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  legal_name: optionalTrimmedString,
  fiscal_year_end: optionalTrimmedString,
})

const memberSchema = z.object({
  user_id: z.string().min(1),
  role: z.enum(['owner', 'admin', 'member', 'viewer']).optional().default('member'),
})

/** Return workspace row if the user is a member, else null. */
async function membershipOf(workspaceId: string, userId: string) {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, workspaceId),
        eq(workspace_members.user_id, userId),
      ),
    )
  return m ?? null
}

async function logActivity(workspaceId: string, userId: string, action: string, target: string) {
  try {
    await db.insert(activity_log).values({ workspace_id: workspaceId, user_id: userId, action, target })
  } catch {
    // best-effort; never block the request
  }
}

// GET / — list workspaces the current user belongs to
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const memberships = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.user_id, userId))
  const ids = memberships.map((m) => m.workspace_id)
  if (ids.length === 0) return c.json([])
  const rows = await db.select().from(workspaces).orderBy(desc(workspaces.created_at))
  const set = new Set(ids)
  return c.json(rows.filter((w) => set.has(w.id)))
})

// POST / — create workspace; creator becomes owner member
router.post('/', authMiddleware, zValidator('json', workspaceCreateSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [ws] = await db
    .insert(workspaces)
    .values({
      name: body.name,
      owner_id: userId,
      legal_name: body.legal_name ?? null,
      fiscal_year_end: body.fiscal_year_end ?? null,
    })
    .returning()
  await db.insert(workspace_members).values({
    workspace_id: ws.id,
    user_id: userId,
    role: 'owner',
  })
  await logActivity(ws.id, userId, 'workspace.create', ws.name)
  return c.json(ws, 201)
})

// GET /:id — workspace detail (any member)
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  const m = await membershipOf(id, userId)
  if (!m) return c.json({ error: 'Forbidden' }, 403)
  return c.json(ws)
})

// PUT /:id — update workspace (owner only)
router.put('/:id', authMiddleware, zValidator('json', workspaceUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  if (ws.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.legal_name !== undefined) patch.legal_name = body.legal_name
  if (body.fiscal_year_end !== undefined) patch.fiscal_year_end = body.fiscal_year_end
  const [updated] = await db.update(workspaces).set(patch).where(eq(workspaces.id, id)).returning()
  await logActivity(id, userId, 'workspace.update', updated.name)
  return c.json(updated)
})

// DELETE /:id — delete workspace (owner only) — cascade members
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  if (ws.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [eng] = await db.select().from(engagements).where(eq(engagements.workspace_id, id)).limit(1)
  if (eng) return c.json({ error: 'Workspace has engagements; delete them first' }, 409)
  await db.delete(workspace_members).where(eq(workspace_members.workspace_id, id))
  await db.delete(activity_log).where(eq(activity_log.workspace_id, id))
  await db.delete(workspaces).where(eq(workspaces.id, id))
  return c.json({ success: true })
})

// GET /:id/members — list members (any member)
router.get('/:id/members', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  const m = await membershipOf(id, userId)
  if (!m) return c.json({ error: 'Forbidden' }, 403)
  const members = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.workspace_id, id))
    .orderBy(desc(workspace_members.created_at))
  return c.json(members)
})

// POST /:id/members — add member (owner only)
router.post('/:id/members', authMiddleware, zValidator('json', memberSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  if (ws.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const existing = await membershipOf(id, body.user_id)
  if (existing) {
    const [updated] = await db
      .update(workspace_members)
      .set({ role: body.role })
      .where(
        and(
          eq(workspace_members.workspace_id, id),
          eq(workspace_members.user_id, body.user_id),
        ),
      )
      .returning()
    return c.json(updated)
  }
  const [member] = await db
    .insert(workspace_members)
    .values({ workspace_id: id, user_id: body.user_id, role: body.role })
    .returning()
  await logActivity(id, userId, 'workspace.member.add', body.user_id)
  return c.json(member, 201)
})

// DELETE /:id/members/:memberId — remove member (owner only)
router.delete('/:id/members/:memberId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const memberId = c.req.param('memberId')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  if (ws.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.id, memberId), eq(workspace_members.workspace_id, id)))
  if (!member) return c.json({ error: 'Member not found' }, 404)
  if (member.user_id === ws.owner_id) {
    return c.json({ error: 'Cannot remove the workspace owner' }, 400)
  }
  await db.delete(workspace_members).where(eq(workspace_members.id, memberId))
  await logActivity(id, userId, 'workspace.member.remove', member.user_id)
  return c.json({ success: true })
})

export default router
