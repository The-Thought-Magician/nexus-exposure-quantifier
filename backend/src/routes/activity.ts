import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { db } from '../db/index.js'
import { activity_log, workspaces, workspace_members } from '../db/schema.js'
import { eq, and, desc, gt } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

/** True if the user owns or is a member of the workspace. */
async function canAccessWorkspace(workspaceId: string, userId: string): Promise<boolean> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!ws) return false
  if (ws.owner_id === userId) return true
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!member
}

// Paged workspace activity feed.
router.get('/:workspaceId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.param('workspaceId')
  if (!(await canAccessWorkspace(workspaceId, userId))) return c.json({ error: 'Not found' }, 404)

  const limitRaw = parseInt(c.req.query('limit') ?? '50', 10)
  const offsetRaw = parseInt(c.req.query('offset') ?? '0', 10)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 200)) : 50
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0

  const rows = await db
    .select()
    .from(activity_log)
    .where(eq(activity_log.workspace_id, workspaceId))
    .orderBy(desc(activity_log.created_at))
    .limit(limit)
    .offset(offset)

  return c.json(rows)
})

// Live activity stream (SSE): pushes new activity rows as they arrive.
router.get('/:workspaceId/stream', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.param('workspaceId')
  if (!(await canAccessWorkspace(workspaceId, userId))) return c.json({ error: 'Not found' }, 404)

  return streamSSE(c, async (stream) => {
    // Start from the most recent row so only genuinely new events are pushed.
    const [latest] = await db
      .select()
      .from(activity_log)
      .where(eq(activity_log.workspace_id, workspaceId))
      .orderBy(desc(activity_log.created_at))
      .limit(1)
    let since: Date = latest?.created_at ?? new Date(0)

    let closed = false
    stream.onAbort(() => {
      closed = true
    })

    // Emit up to ~5 minutes of live events, polling every 3s.
    for (let tick = 0; tick < 100 && !closed; tick++) {
      const fresh = await db
        .select()
        .from(activity_log)
        .where(and(eq(activity_log.workspace_id, workspaceId), gt(activity_log.created_at, since)))
        .orderBy(activity_log.created_at)

      for (const row of fresh) {
        await stream.writeSSE({
          event: 'activity',
          data: JSON.stringify(row),
          id: row.id,
        })
        if (row.created_at && row.created_at > since) since = row.created_at
      }

      // Heartbeat keeps intermediaries from closing the connection.
      await stream.writeSSE({ event: 'ping', data: String(Date.now()) })
      await stream.sleep(3000)
    }
  })
})

export default router
