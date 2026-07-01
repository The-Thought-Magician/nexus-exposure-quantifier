import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { assumptions, engagements, workspace_members } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const updateSchema = z.object({
  effective_rate_basis: z.enum(['library', 'blended', 'manual']).optional(),
  include_marketplace_sales: z.boolean().optional(),
  include_exempt_in_measure: z.boolean().optional(),
  compounding: z.enum(['monthly', 'daily', 'annual', 'none']).optional(),
  saas_taxable_stance: z.enum(['per_state', 'taxable', 'exempt']).optional(),
  notes: z.string().optional(),
})

type ChangeLogEntry = { at: string; user_id: string; field: string; from: string; to: string }

/** Verify the user may access the engagement (owner or workspace member). Returns the engagement or null. */
async function engagementForUser(engagementId: string, userId: string) {
  const [eng] = await db.select().from(engagements).where(eq(engagements.id, engagementId))
  if (!eng) return null
  if (eng.user_id === userId) return eng
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, eng.workspace_id),
        eq(workspace_members.user_id, userId),
      ),
    )
  return m ? eng : null
}

/** Fetch existing assumptions row, creating a default one if none exists. */
async function getOrCreate(engagementId: string) {
  const [existing] = await db
    .select()
    .from(assumptions)
    .where(eq(assumptions.engagement_id, engagementId))
  if (existing) return existing
  const [created] = await db
    .insert(assumptions)
    .values({ engagement_id: engagementId })
    .returning()
  return created
}

// GET /:engagementId — get assumptions (creates default if none)
router.get('/:engagementId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const eng = await engagementForUser(engagementId, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  const row = await getOrCreate(engagementId)
  return c.json(row)
})

// PUT /:engagementId — update assumptions, append change_log
router.put('/:engagementId', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const eng = await engagementForUser(engagementId, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  if (eng.is_locked) return c.json({ error: 'Engagement is locked' }, 409)

  const current = await getOrCreate(engagementId)
  const body = c.req.valid('json')
  const now = new Date().toISOString()

  const tracked: Array<keyof typeof body> = [
    'effective_rate_basis',
    'include_marketplace_sales',
    'include_exempt_in_measure',
    'compounding',
    'saas_taxable_stance',
    'notes',
  ]

  const entries: ChangeLogEntry[] = []
  const patch: Record<string, unknown> = {}
  for (const field of tracked) {
    const next = body[field]
    if (next === undefined) continue
    const prev = (current as Record<string, unknown>)[field]
    if (String(prev) !== String(next)) {
      entries.push({ at: now, user_id: userId, field, from: String(prev), to: String(next) })
      patch[field] = next
    }
  }

  if (entries.length === 0) {
    return c.json(current)
  }

  const priorLog: ChangeLogEntry[] = Array.isArray(current.change_log)
    ? (current.change_log as ChangeLogEntry[])
    : []
  patch.change_log = [...priorLog, ...entries]
  patch.updated_at = new Date()

  const [updated] = await db
    .update(assumptions)
    .set(patch)
    .where(eq(assumptions.engagement_id, engagementId))
    .returning()
  return c.json(updated)
})

// GET /:engagementId/log — assumption change log
router.get('/:engagementId/log', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const eng = await engagementForUser(engagementId, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  const row = await getOrCreate(engagementId)
  const log: ChangeLogEntry[] = Array.isArray(row.change_log)
    ? (row.change_log as ChangeLogEntry[])
    : []
  // newest first
  return c.json([...log].reverse())
})

export default router
