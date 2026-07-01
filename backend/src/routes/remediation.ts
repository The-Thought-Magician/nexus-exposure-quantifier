import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { engagements, workspace_members, remediation_items } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const STATUSES = ['not_started', 'in_progress', 'blocked', 'complete'] as const

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

type Item = typeof remediation_items.$inferSelect

function rollup(items: Item[]) {
  const byStatus: Record<string, number> = {
    not_started: 0,
    in_progress: 0,
    blocked: 0,
    complete: 0,
  }
  let checklistTotal = 0
  let checklistDone = 0
  for (const it of items) {
    byStatus[it.status] = (byStatus[it.status] ?? 0) + 1
    const cl = it.checklist ?? []
    checklistTotal += cl.length
    checklistDone += cl.filter((x) => x.done).length
  }
  const total = items.length
  const completedStates = byStatus.complete
  return {
    total_states: total,
    completed_states: completedStates,
    by_status: byStatus,
    state_completion_pct: total ? Math.round((completedStates / total) * 100) : 0,
    checklist_total: checklistTotal,
    checklist_done: checklistDone,
    checklist_completion_pct: checklistTotal ? Math.round((checklistDone / checklistTotal) * 100) : 0,
  }
}

// ---------------------------------------------------------------------------
// GET /:engagementId — remediation items + progress rollup
// ---------------------------------------------------------------------------
router.get('/:engagementId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const items = await db
    .select()
    .from(remediation_items)
    .where(eq(remediation_items.engagement_id, engagementId))
    .orderBy(desc(remediation_items.updated_at))
  return c.json({ items, progress: rollup(items) })
})

// ---------------------------------------------------------------------------
// POST /:engagementId — upsert a remediation item for a state
// ---------------------------------------------------------------------------
const upsertSchema = z.object({
  state: z.string().min(2).max(2),
  status: z.enum(STATUSES).optional(),
  owner: z.string().optional(),
  target_date: z.string().datetime().nullable().optional(),
  checklist: z.array(z.object({ label: z.string().min(1), done: z.boolean() })).optional(),
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
  if (body.status !== undefined) setFields.status = body.status
  if (body.owner !== undefined) setFields.owner = body.owner
  if (body.target_date !== undefined) setFields.target_date = body.target_date ? new Date(body.target_date) : null
  if (body.checklist !== undefined) setFields.checklist = body.checklist
  if (body.notes !== undefined) setFields.notes = body.notes

  const [item] = await db
    .insert(remediation_items)
    .values({
      engagement_id: engagementId,
      user_id: userId,
      state,
      status: body.status ?? 'not_started',
      owner: body.owner ?? '',
      target_date: body.target_date ? new Date(body.target_date) : null,
      checklist: body.checklist ?? [],
      notes: body.notes ?? '',
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [remediation_items.engagement_id, remediation_items.state],
      set: setFields,
    })
    .returning()

  return c.json(item, 201)
})

// ---------------------------------------------------------------------------
// PUT /:engagementId/:id — update an item (status/owner/checklist/etc)
// ---------------------------------------------------------------------------
const updateSchema = z.object({
  status: z.enum(STATUSES).optional(),
  owner: z.string().optional(),
  target_date: z.string().datetime().nullable().optional(),
  checklist: z.array(z.object({ label: z.string().min(1), done: z.boolean() })).optional(),
  notes: z.string().optional(),
})

router.put('/:engagementId/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const [existing] = await db
    .select()
    .from(remediation_items)
    .where(and(eq(remediation_items.id, id), eq(remediation_items.engagement_id, engagementId)))
  if (!existing) return c.json({ error: 'Remediation item not found' }, 404)

  const setFields: Record<string, unknown> = { updated_at: new Date() }
  if (body.status !== undefined) setFields.status = body.status
  if (body.owner !== undefined) setFields.owner = body.owner
  if (body.target_date !== undefined) setFields.target_date = body.target_date ? new Date(body.target_date) : null
  if (body.checklist !== undefined) setFields.checklist = body.checklist
  if (body.notes !== undefined) setFields.notes = body.notes

  const [updated] = await db
    .update(remediation_items)
    .set(setFields)
    .where(eq(remediation_items.id, id))
    .returning()
  return c.json(updated)
})

export default router
