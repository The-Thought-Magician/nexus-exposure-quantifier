import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  engagements,
  workspace_members,
  state_exposures,
  crossing_results,
  assumptions,
  memos,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Ownership: the caller must own the engagement or belong to its workspace.
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

function usd(n: number): string {
  return `$${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

// ---------------------------------------------------------------------------
// GET /:engagementId — list memos for an engagement
// ---------------------------------------------------------------------------
router.get('/:engagementId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .select()
    .from(memos)
    .where(eq(memos.engagement_id, engagementId))
    .orderBy(desc(memos.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /:engagementId — generate a memo (consolidated | state)
// ---------------------------------------------------------------------------
const generateSchema = z.object({
  scope: z.enum(['consolidated', 'state']).default('consolidated'),
  state: z.string().min(2).max(2).optional(),
  title: z.string().min(1).optional(),
})

router.post('/:engagementId', authMiddleware, zValidator('json', generateSchema), async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const body = c.req.valid('json')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  if (body.scope === 'state' && !body.state) {
    return c.json({ error: 'state is required when scope is "state"' }, 400)
  }
  const state = body.scope === 'state' ? body.state!.toUpperCase() : null

  // Pull computed exposures + crossings for the memo body.
  const exposuresAll = await db
    .select()
    .from(state_exposures)
    .where(eq(state_exposures.engagement_id, engagementId))
  const crossingsAll = await db
    .select()
    .from(crossing_results)
    .where(eq(crossing_results.engagement_id, engagementId))
  const [assump] = await db
    .select()
    .from(assumptions)
    .where(eq(assumptions.engagement_id, engagementId))

  const exposures = state
    ? exposuresAll.filter((e) => e.state === state)
    : exposuresAll
  const crossings = state
    ? crossingsAll.filter((x) => x.state === state)
    : crossingsAll

  const sortedExp = [...exposures].sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
  const totalTax = exposures.reduce((s, e) => s + (e.tax ?? 0), 0)
  const totalPenalty = exposures.reduce((s, e) => s + (e.penalty ?? 0), 0)
  const totalInterest = exposures.reduce((s, e) => s + (e.interest ?? 0), 0)
  const totalExposure = exposures.reduce((s, e) => s + (e.total ?? 0), 0)
  const totalVdaSavings = exposures.reduce((s, e) => s + (e.vda_savings ?? 0), 0)
  const crossedCount = crossings.filter((x) => x.has_crossed).length

  const asOf = eng.as_of_date instanceof Date ? eng.as_of_date : new Date(eng.as_of_date)
  const asOfStr = asOf.toISOString().slice(0, 10)

  const sections: Array<{ heading: string; body: string }> = []

  sections.push({
    heading: 'Purpose & Scope',
    body:
      body.scope === 'state'
        ? `This memorandum quantifies the potential sales-and-use tax exposure of ${eng.name} in ${state} as of ${asOfStr}. It is limited to a single jurisdiction and should be read alongside the consolidated analysis.`
        : `This memorandum quantifies the potential multi-state sales-and-use tax exposure of ${eng.name} as of ${asOfStr}, covering ${exposures.length} state(s) with computed exposure.`,
  })

  sections.push({
    heading: 'Exposure Summary',
    body: [
      `Estimated tax: ${usd(totalTax)}.`,
      `Estimated penalties: ${usd(totalPenalty)}.`,
      `Estimated interest: ${usd(totalInterest)}.`,
      `Total estimated exposure: ${usd(totalExposure)}.`,
      `Estimated VDA savings if remediated voluntarily: ${usd(totalVdaSavings)}.`,
      `${crossedCount} of ${crossings.length} analyzed state(s) have crossed an economic-nexus threshold.`,
    ].join(' '),
  })

  if (body.scope === 'consolidated') {
    const topLines = sortedExp.slice(0, 10).map((e, i) => {
      const band = e.materiality_band ?? 'low'
      return `${i + 1}. ${e.state}: total ${usd(e.total ?? 0)} (tax ${usd(e.tax ?? 0)}, penalty ${usd(e.penalty ?? 0)}, interest ${usd(e.interest ?? 0)}) — ${band} materiality.`
    })
    sections.push({
      heading: 'State-by-State Ranking',
      body: topLines.length ? topLines.join('\n') : 'No computed state exposures. Run exposure computation first.',
    })
  } else {
    const one = sortedExp[0]
    const cx = crossings[0]
    if (one) {
      sections.push({
        heading: `${state} Detail`,
        body: [
          `Tax ${usd(one.tax ?? 0)}, penalty ${usd(one.penalty ?? 0)}, interest ${usd(one.interest ?? 0)}, total ${usd(one.total ?? 0)}.`,
          `Materiality band: ${one.materiality_band ?? 'low'}.`,
          cx?.has_crossed && cx.crossing_date
            ? `Nexus crossed on ${new Date(cx.crossing_date).toISOString().slice(0, 10)} via the ${cx.tripping_test ?? 'sales'} test.`
            : 'No economic-nexus crossing detected for this state.',
          `VDA-adjusted total ${usd(one.vda_total ?? 0)}, saving ${usd(one.vda_savings ?? 0)}.`,
        ].join(' '),
      })
    } else {
      sections.push({
        heading: `${state} Detail`,
        body: 'No computed exposure for this state. Run exposure computation first.',
      })
    }
  }

  sections.push({
    heading: 'Key Assumptions',
    body: assump
      ? [
          `Rate basis: ${assump.effective_rate_basis}.`,
          `Marketplace sales ${assump.include_marketplace_sales ? 'included' : 'excluded'} in the nexus measure.`,
          `Exempt sales ${assump.include_exempt_in_measure ? 'included' : 'excluded'} in the nexus measure.`,
          `Interest compounding: ${assump.compounding}.`,
          `SaaS taxability stance: ${assump.saas_taxable_stance}.`,
        ].join(' ')
      : 'Default assumptions applied; no explicit assumptions register was configured for this engagement.',
  })

  sections.push({
    heading: 'Recommendation',
    body:
      totalVdaSavings > 0
        ? `Given estimated VDA savings of ${usd(totalVdaSavings)}, voluntary disclosure is likely advantageous where nexus has been established. Prioritize the highest-materiality states for remediation.`
        : 'Continue monitoring nexus thresholds. No material VDA advantage was computed; register prospectively where nexus is established.',
  })

  const title =
    body.title ??
    (body.scope === 'state'
      ? `${eng.name} — ${state} Exposure Memo (${asOfStr})`
      : `${eng.name} — Consolidated Exposure Memo (${asOfStr})`)

  const [memo] = await db
    .insert(memos)
    .values({
      engagement_id: engagementId,
      user_id: userId,
      title,
      scope: body.scope,
      state,
      content: { sections },
      as_of_date: asOf,
    })
    .returning()

  return c.json(memo, 201)
})

// ---------------------------------------------------------------------------
// GET /:engagementId/:memoId — get one memo
// ---------------------------------------------------------------------------
router.get('/:engagementId/:memoId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const memoId = c.req.param('memoId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const [memo] = await db
    .select()
    .from(memos)
    .where(and(eq(memos.id, memoId), eq(memos.engagement_id, engagementId)))
  if (!memo) return c.json({ error: 'Memo not found' }, 404)
  return c.json(memo)
})

// ---------------------------------------------------------------------------
// DELETE /:engagementId/:memoId — delete a memo
// ---------------------------------------------------------------------------
router.delete('/:engagementId/:memoId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const memoId = c.req.param('memoId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const [memo] = await db
    .select()
    .from(memos)
    .where(and(eq(memos.id, memoId), eq(memos.engagement_id, engagementId)))
  if (!memo) return c.json({ error: 'Memo not found' }, 404)

  await db.delete(memos).where(eq(memos.id, memoId))
  return c.json({ success: true })
})

export default router
