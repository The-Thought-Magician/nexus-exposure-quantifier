import { Hono } from 'hono'
import { db } from '../db/index.js'
import { notifications } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// All notification endpoints are per-user and auth-gated.
router.use('*', authMiddleware)

// List the current user's notifications (newest first).
router.get('/', async (c) => {
  const userId = getUserId(c)
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.user_id, userId))
    .orderBy(desc(notifications.created_at))
  return c.json(rows)
})

// Mark a single notification read (must belong to the current user).
router.post('/:id/read', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.user_id, userId)))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const [updated] = await db
    .update(notifications)
    .set({ is_read: true })
    .where(eq(notifications.id, id))
    .returning()
  return c.json(updated)
})

// Mark every notification for the current user read.
router.post('/read-all', async (c) => {
  const userId = getUserId(c)
  await db
    .update(notifications)
    .set({ is_read: true })
    .where(and(eq(notifications.user_id, userId), eq(notifications.is_read, false)))
  return c.json({ success: true })
})

export default router
