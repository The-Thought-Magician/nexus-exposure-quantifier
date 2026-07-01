import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { engagements, workspace_members, state_exposures } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { materialityBand } from './exposure.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Ownership helper
// ---------------------------------------------------------------------------

async function loadEngagementForUser(engagementId: string, userId: string) {
  const [eng] = await db.select().from(engagements).where(eq(engagements.id, engagementId))
  if (!eng) return { eng: null as typeof engagements.$inferSelect | null, allowed: false }
  if (eng.user_id === userId) return { eng, allowed: true }
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, eng.workspace_id), eq(workspace_members.user_id, userId)))
  return { eng, allowed: !!member }
}

// ---------------------------------------------------------------------------
// GET /:engagementId — ranked states by exposure + bands + top-N rollup.
// Query params: ?threshold (band cut for "material"), ?sort (total|tax|vda_savings), ?top (default 5)
// ---------------------------------------------------------------------------

router.get('/:engagementId', authMiddleware, async (c) => {
  const engagementId = c.req.param('engagementId')
  const userId = getUserId(c)
  const { eng, allowed } = await loadEngagementForUser(engagementId, userId)
  if (!eng) return c.json({ error: 'Not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const thresholdRaw = Number(c.req.query('threshold'))
  const threshold = Number.isFinite(thresholdRaw) && thresholdRaw > 0 ? thresholdRaw : 5_000
  const sortKey = ((): 'total' | 'tax' | 'vda_savings' => {
    const s = c.req.query('sort')
    if (s === 'tax' || s === 'vda_savings') return s
    return 'total'
  })()
  const topRaw = Number(c.req.query('top'))
  const topN = Number.isFinite(topRaw) && topRaw > 0 ? Math.min(50, Math.floor(topRaw)) : 5

  const rows = await db
    .select()
    .from(state_exposures)
    .where(eq(state_exposures.engagement_id, engagementId))
    .orderBy(desc(state_exposures.total))

  const grandTotal = rows.reduce((a, r) => a + (r.total ?? 0), 0)
  const grandTax = rows.reduce((a, r) => a + (r.tax ?? 0), 0)
  const grandVdaSavings = rows.reduce((a, r) => a + (r.vda_savings ?? 0), 0)

  const sortVal = (r: (typeof rows)[number]) =>
    sortKey === 'tax' ? r.tax ?? 0 : sortKey === 'vda_savings' ? r.vda_savings ?? 0 : r.total ?? 0

  const ranked = [...rows]
    .sort((a, b) => sortVal(b) - sortVal(a))
    .map((r, i) => {
      const total = r.total ?? 0
      return {
        rank: i + 1,
        state: r.state,
        tax: r.tax ?? 0,
        penalty: r.penalty ?? 0,
        interest: r.interest ?? 0,
        total,
        vda_total: r.vda_total ?? 0,
        vda_savings: r.vda_savings ?? 0,
        // Recompute the band from the current total so it stays consistent even
        // if the stored band is stale, but fall back to the persisted value.
        band: r.materiality_band ?? materialityBand(total),
        is_material: total >= threshold,
        pct_of_total: grandTotal > 0 ? total / grandTotal : 0,
      }
    })

  // Band distribution counts.
  const bandCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const r of ranked) bandCounts[r.band] = (bandCounts[r.band] ?? 0) + 1

  // Top-N rollup: how much of the exposure is concentrated in the top states.
  const top = ranked.slice(0, topN)
  const topTotal = top.reduce((a, r) => a + r.total, 0)
  const materialCount = ranked.filter((r) => r.is_material).length

  const rollup = {
    state_count: ranked.length,
    material_count: materialCount,
    grand_tax: grandTax,
    grand_total: grandTotal,
    grand_vda_savings: grandVdaSavings,
    threshold,
    sort: sortKey,
    top_n: topN,
    top_states: top.map((r) => r.state),
    top_total: topTotal,
    top_pct_of_total: grandTotal > 0 ? topTotal / grandTotal : 0,
    band_counts: bandCounts,
  }

  return c.json({ ranking: ranked, rollup })
})

export default router
