import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { sales_lines, engagements, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Ownership helper: the requesting user must own the engagement or be a member
// of its workspace.
// ---------------------------------------------------------------------------
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

const salesLineSchema = z.object({
  sale_date: z.string().min(1),
  state: z.string().min(2),
  jurisdiction: z.string().optional().default(''),
  amount: z.number(),
  is_taxable: z.boolean().optional().default(true),
  is_marketplace: z.boolean().optional().default(false),
  transaction_ref: z.string().optional().default(''),
  product_category: z.string().optional().default(''),
  exempt_reason: z.string().optional().default(''),
})

const bulkSchema = z.object({
  rows: z.array(salesLineSchema).min(1),
})

// GET /:engagementId — list sales lines (paged, ?state)
router.get('/:engagementId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const state = c.req.query('state')
  const limit = Math.min(parseInt(c.req.query('limit') ?? '200', 10) || 200, 1000)
  const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10) || 0, 0)

  const conditions = [eq(sales_lines.engagement_id, engagementId)]
  if (state) conditions.push(eq(sales_lines.state, state))

  const rows = await db
    .select()
    .from(sales_lines)
    .where(and(...conditions))
    .orderBy(desc(sales_lines.sale_date))
    .limit(limit)
    .offset(offset)

  return c.json(rows)
})

// POST /:engagementId — add one sales line
router.post('/:engagementId', authMiddleware, zValidator('json', salesLineSchema), async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)
  if (eng.is_locked) return c.json({ error: 'Engagement is locked' }, 409)

  const body = c.req.valid('json')
  const [line] = await db
    .insert(sales_lines)
    .values({
      engagement_id: engagementId,
      sale_date: new Date(body.sale_date),
      state: body.state,
      jurisdiction: body.jurisdiction,
      amount: body.amount,
      is_taxable: body.is_taxable,
      is_marketplace: body.is_marketplace,
      transaction_ref: body.transaction_ref,
      product_category: body.product_category,
      exempt_reason: body.exempt_reason,
    })
    .returning()
  return c.json(line, 201)
})

// POST /:engagementId/bulk — add many sales lines
router.post('/:engagementId/bulk', authMiddleware, zValidator('json', bulkSchema), async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)
  if (eng.is_locked) return c.json({ error: 'Engagement is locked' }, 409)

  const { rows } = c.req.valid('json')
  const values = rows.map((r) => ({
    engagement_id: engagementId,
    sale_date: new Date(r.sale_date),
    state: r.state,
    jurisdiction: r.jurisdiction,
    amount: r.amount,
    is_taxable: r.is_taxable,
    is_marketplace: r.is_marketplace,
    transaction_ref: r.transaction_ref,
    product_category: r.product_category,
    exempt_reason: r.exempt_reason,
  }))
  const inserted = await db.insert(sales_lines).values(values).returning()
  return c.json({ inserted: inserted.length }, 201)
})

// DELETE /:engagementId — delete all sales lines for engagement
router.delete('/:engagementId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)
  if (eng.is_locked) return c.json({ error: 'Engagement is locked' }, 409)

  await db.delete(sales_lines).where(eq(sales_lines.engagement_id, engagementId))
  return c.json({ success: true })
})

// DELETE /:engagementId/:lineId — delete one sales line
router.delete('/:engagementId/:lineId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const lineId = c.req.param('lineId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)
  if (eng.is_locked) return c.json({ error: 'Engagement is locked' }, 409)

  const [existing] = await db
    .select()
    .from(sales_lines)
    .where(and(eq(sales_lines.id, lineId), eq(sales_lines.engagement_id, engagementId)))
  if (!existing) return c.json({ error: 'Sales line not found' }, 404)

  await db.delete(sales_lines).where(eq(sales_lines.id, lineId))
  return c.json({ success: true })
})

// GET /:engagementId/summary — per-state sales totals
router.get('/:engagementId/summary', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db.select().from(sales_lines).where(eq(sales_lines.engagement_id, engagementId))

  const byState = new Map<
    string,
    {
      state: string
      transactions: number
      total_sales: number
      taxable_sales: number
      exempt_sales: number
      marketplace_sales: number
      first_sale: string | null
      last_sale: string | null
    }
  >()

  for (const r of rows) {
    let s = byState.get(r.state)
    if (!s) {
      s = {
        state: r.state,
        transactions: 0,
        total_sales: 0,
        taxable_sales: 0,
        exempt_sales: 0,
        marketplace_sales: 0,
        first_sale: null,
        last_sale: null,
      }
      byState.set(r.state, s)
    }
    s.transactions += 1
    s.total_sales += r.amount
    if (r.is_taxable) s.taxable_sales += r.amount
    else s.exempt_sales += r.amount
    if (r.is_marketplace) s.marketplace_sales += r.amount
    const iso = new Date(r.sale_date).toISOString()
    if (s.first_sale === null || iso < s.first_sale) s.first_sale = iso
    if (s.last_sale === null || iso > s.last_sale) s.last_sale = iso
  }

  const summary = [...byState.values()].sort((a, b) => b.total_sales - a.total_sales)
  return c.json(summary)
})

export default router
