import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  snapshots,
  engagements,
  workspace_members,
  state_exposures,
  crossing_results,
  scenarios,
  assumptions,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// --- helpers ----------------------------------------------------------------

/** Return the engagement if the user owns it or belongs to its workspace, else null. */
async function ownedEngagement(engagementId: string, userId: string) {
  const [eng] = await db.select().from(engagements).where(eq(engagements.id, engagementId))
  if (!eng) return null
  if (eng.user_id === userId) return eng
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, eng.workspace_id), eq(workspace_members.user_id, userId)))
  if (member) return eng
  return null
}

function randomToken(): string {
  // URL-safe random share token.
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '')
}

/** Assemble the frozen snapshot payload for an engagement. */
async function buildSnapshotData(engagementId: string) {
  const [eng] = await db.select().from(engagements).where(eq(engagements.id, engagementId))
  const stateExposures = await db
    .select()
    .from(state_exposures)
    .where(eq(state_exposures.engagement_id, engagementId))
    .orderBy(desc(state_exposures.total))
  const crossings = await db
    .select()
    .from(crossing_results)
    .where(eq(crossing_results.engagement_id, engagementId))
  const scenarioRows = await db
    .select()
    .from(scenarios)
    .where(eq(scenarios.engagement_id, engagementId))
    .orderBy(desc(scenarios.computed_at))
  const [assumptionRow] = await db
    .select()
    .from(assumptions)
    .where(eq(assumptions.engagement_id, engagementId))

  return {
    engagement: eng ?? null,
    totals: eng
      ? {
          total_tax: eng.total_tax ?? 0,
          total_penalty: eng.total_penalty ?? 0,
          total_interest: eng.total_interest ?? 0,
          total_exposure: eng.total_exposure ?? 0,
          total_vda_savings: eng.total_vda_savings ?? 0,
        }
      : null,
    state_exposures: stateExposures,
    crossings,
    scenarios: scenarioRows,
    assumptions: assumptionRow ?? null,
    frozen_at: new Date().toISOString(),
  }
}

// --- routes -----------------------------------------------------------------

// Public read-only snapshot by share token. Placed before /:engagementId so
// the literal "shared" segment is not swallowed as an engagement id.
router.get('/shared/:token', async (c) => {
  const token = c.req.param('token')
  const [snap] = await db.select().from(snapshots).where(eq(snapshots.share_token, token))
  if (!snap) return c.json({ error: 'Not found' }, 404)
  return c.json(snap)
})

// List snapshots for an engagement (auth + ownership).
router.get('/:engagementId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const eng = await ownedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  const rows = await db
    .select()
    .from(snapshots)
    .where(eq(snapshots.engagement_id, engagementId))
    .orderBy(desc(snapshots.created_at))
  return c.json(rows)
})

const createSchema = z.object({
  label: z.string().min(1).max(200),
})

// Create a locked shareable snapshot (freezes current computed results).
router.post('/:engagementId', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const eng = await ownedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  const { label } = c.req.valid('json')

  const data = await buildSnapshotData(engagementId)
  const share_token = randomToken()

  const [snap] = await db
    .insert(snapshots)
    .values({
      engagement_id: engagementId,
      user_id: userId,
      share_token,
      label,
      data: data as Record<string, unknown>,
    })
    .returning()

  await db.insert(activity_log).values({
    workspace_id: eng.workspace_id,
    user_id: userId,
    action: 'snapshot.created',
    target: engagementId,
    meta: { snapshot_id: snap.id, label },
  })

  return c.json(snap, 201)
})

// Delete a snapshot (auth + ownership).
router.delete('/:engagementId/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const id = c.req.param('id')
  const eng = await ownedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  const [snap] = await db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.id, id), eq(snapshots.engagement_id, engagementId)))
  if (!snap) return c.json({ error: 'Not found' }, 404)
  await db.delete(snapshots).where(eq(snapshots.id, id))
  return c.json({ success: true })
})

export default router
