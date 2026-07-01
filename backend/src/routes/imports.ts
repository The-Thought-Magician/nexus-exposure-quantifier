import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { import_jobs, import_errors, sales_lines, engagements, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Ownership helper
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

const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY',
  'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC',
])

// ---------------------------------------------------------------------------
// CSV parser (RFC-4180-ish: quoted fields, escaped quotes, embedded newlines)
// ---------------------------------------------------------------------------
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }
  // flush trailing field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // drop fully-empty trailing rows
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''))
}

interface MappedRow {
  sale_date: Date
  state: string
  amount: number
  jurisdiction: string
  is_taxable: boolean
  is_marketplace: boolean
  transaction_ref: string
  product_category: string
  exempt_reason: string
}

function parseBool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v.trim() === '') return dflt
  const s = v.trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 't'].includes(s)) return true
  if (['0', 'false', 'no', 'n', 'f'].includes(s)) return false
  return dflt
}

/** Validate + coerce one record (object keyed by canonical field name). */
function validateRecord(rec: Record<string, string>): { ok: true; row: MappedRow } | { ok: false; message: string } {
  const rawDate = (rec.sale_date ?? '').trim()
  if (!rawDate) return { ok: false, message: 'Missing sale_date' }
  const parsedDate = new Date(rawDate)
  if (Number.isNaN(parsedDate.getTime())) return { ok: false, message: `Invalid sale_date: "${rawDate}"` }

  const state = (rec.state ?? '').trim().toUpperCase()
  if (!state) return { ok: false, message: 'Missing state' }
  if (!US_STATES.has(state)) return { ok: false, message: `Unrecognized state code: "${state}"` }

  const rawAmount = (rec.amount ?? '').trim().replace(/[$,]/g, '')
  if (!rawAmount) return { ok: false, message: 'Missing amount' }
  const amount = Number(rawAmount)
  if (!Number.isFinite(amount)) return { ok: false, message: `Invalid amount: "${rec.amount}"` }

  return {
    ok: true,
    row: {
      sale_date: parsedDate,
      state,
      amount,
      jurisdiction: (rec.jurisdiction ?? '').trim(),
      is_taxable: parseBool(rec.is_taxable, true),
      is_marketplace: parseBool(rec.is_marketplace, false),
      transaction_ref: (rec.transaction_ref ?? '').trim(),
      product_category: (rec.product_category ?? '').trim(),
      exempt_reason: (rec.exempt_reason ?? '').trim(),
    },
  }
}

// GET /:engagementId — list import jobs
router.get('/:engagementId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const jobs = await db
    .select()
    .from(import_jobs)
    .where(eq(import_jobs.engagement_id, engagementId))
    .orderBy(desc(import_jobs.created_at))
  return c.json(jobs)
})

// POST /:engagementId/csv — create CSV import job, validate + insert rows
const csvSchema = z.object({
  content: z.string().min(1),
  has_header: z.boolean().optional().default(true),
  // optional mapping: canonical field -> CSV column header name
  column_mapping: z.record(z.string(), z.string()).optional(),
})

router.post('/:engagementId/csv', authMiddleware, zValidator('json', csvSchema), async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)
  if (eng.is_locked) return c.json({ error: 'Engagement is locked' }, 409)

  const { content, has_header, column_mapping } = c.req.valid('json')
  const grid = parseCsv(content)
  if (grid.length === 0) return c.json({ error: 'CSV is empty' }, 400)

  // Determine header row + canonical column indexes.
  const canonicalFields = [
    'sale_date',
    'state',
    'amount',
    'jurisdiction',
    'is_taxable',
    'is_marketplace',
    'transaction_ref',
    'product_category',
    'exempt_reason',
  ]

  let headerNames: string[]
  let dataStart: number
  if (has_header) {
    headerNames = grid[0].map((h) => h.trim())
    dataStart = 1
  } else {
    // positional: first N columns map to canonicalFields in order
    headerNames = canonicalFields
    dataStart = 0
  }

  // Build header name -> index. Column mapping (if given) maps canonical -> header name.
  const headerIndex = new Map<string, number>()
  headerNames.forEach((h, idx) => headerIndex.set(h.toLowerCase(), idx))

  function resolveIndex(field: string): number | undefined {
    if (column_mapping && column_mapping[field]) {
      return headerIndex.get(column_mapping[field].toLowerCase())
    }
    return headerIndex.get(field.toLowerCase())
  }

  const fieldIndex: Record<string, number | undefined> = {}
  for (const f of canonicalFields) fieldIndex[f] = resolveIndex(f)

  const [job] = await db
    .insert(import_jobs)
    .values({
      engagement_id: engagementId,
      user_id: userId,
      source: 'csv',
      status: 'processing',
      column_mapping: column_mapping ?? {},
    })
    .returning()

  const validRows: Array<MappedRow & { engagement_id: string; import_job_id: string }> = []
  const errors: Array<{ row_number: number; message: string; raw_row: Record<string, string> }> = []

  for (let r = dataStart; r < grid.length; r++) {
    const cells = grid[r]
    const rec: Record<string, string> = {}
    for (const f of canonicalFields) {
      const idx = fieldIndex[f]
      rec[f] = idx === undefined ? '' : (cells[idx] ?? '')
    }
    const rawRow: Record<string, string> = {}
    headerNames.forEach((h, idx) => {
      rawRow[h || `col_${idx}`] = cells[idx] ?? ''
    })
    const result = validateRecord(rec)
    const rowNumber = has_header ? r : r + 1
    if (result.ok) {
      validRows.push({ ...result.row, engagement_id: engagementId, import_job_id: job.id })
    } else {
      errors.push({ row_number: rowNumber, message: result.message, raw_row: rawRow })
    }
  }

  if (validRows.length > 0) {
    // batch insert in chunks to stay within statement limits
    const chunkSize = 500
    for (let i = 0; i < validRows.length; i += chunkSize) {
      await db.insert(sales_lines).values(validRows.slice(i, i + chunkSize))
    }
  }
  if (errors.length > 0) {
    await db.insert(import_errors).values(
      errors.map((e) => ({
        import_job_id: job.id,
        row_number: e.row_number,
        message: e.message,
        raw_row: e.raw_row,
      })),
    )
  }

  const [updated] = await db
    .update(import_jobs)
    .set({
      status: errors.length > 0 && validRows.length === 0 ? 'failed' : 'completed',
      row_count: validRows.length,
      error_count: errors.length,
    })
    .where(eq(import_jobs.id, job.id))
    .returning()

  return c.json(updated, 201)
})

// POST /:engagementId/connector — create connector import job (Stripe/Shopify/etc)
const connectorSchema = z.object({
  source: z.enum(['stripe', 'shopify', 'quickbooks', 'netsuite', 'amazon', 'square']),
  rows: z
    .array(
      z.object({
        sale_date: z.string().min(1),
        state: z.string().min(2),
        amount: z.number(),
        jurisdiction: z.string().optional().default(''),
        is_taxable: z.boolean().optional().default(true),
        is_marketplace: z.boolean().optional().default(false),
        transaction_ref: z.string().optional().default(''),
        product_category: z.string().optional().default(''),
        exempt_reason: z.string().optional().default(''),
      }),
    )
    .optional()
    .default([]),
})

router.post('/:engagementId/connector', authMiddleware, zValidator('json', connectorSchema), async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)
  if (eng.is_locked) return c.json({ error: 'Engagement is locked' }, 409)

  const { source, rows } = c.req.valid('json')

  const [job] = await db
    .insert(import_jobs)
    .values({
      engagement_id: engagementId,
      user_id: userId,
      source,
      status: 'processing',
    })
    .returning()

  const valid: Array<MappedRow & { engagement_id: string; import_job_id: string }> = []
  const errors: Array<{ row_number: number; message: string; raw_row: Record<string, string> }> = []

  rows.forEach((raw, idx) => {
    const rec: Record<string, string> = {
      sale_date: raw.sale_date,
      state: raw.state,
      amount: String(raw.amount),
      jurisdiction: raw.jurisdiction,
      is_taxable: String(raw.is_taxable),
      is_marketplace: String(raw.is_marketplace),
      transaction_ref: raw.transaction_ref,
      product_category: raw.product_category,
      exempt_reason: raw.exempt_reason,
    }
    const result = validateRecord(rec)
    if (result.ok) {
      valid.push({ ...result.row, engagement_id: engagementId, import_job_id: job.id })
    } else {
      errors.push({ row_number: idx + 1, message: result.message, raw_row: rec })
    }
  })

  if (valid.length > 0) {
    const chunkSize = 500
    for (let i = 0; i < valid.length; i += chunkSize) {
      await db.insert(sales_lines).values(valid.slice(i, i + chunkSize))
    }
  }
  if (errors.length > 0) {
    await db.insert(import_errors).values(
      errors.map((e) => ({
        import_job_id: job.id,
        row_number: e.row_number,
        message: e.message,
        raw_row: e.raw_row,
      })),
    )
  }

  const [updated] = await db
    .update(import_jobs)
    .set({
      status: errors.length > 0 && valid.length === 0 ? 'failed' : 'completed',
      row_count: valid.length,
      error_count: errors.length,
    })
    .where(eq(import_jobs.id, job.id))
    .returning()

  return c.json(updated, 201)
})

// POST /:engagementId/sample — seed realistic sample multi-state sales
router.post('/:engagementId/sample', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)
  if (eng.is_locked) return c.json({ error: 'Engagement is locked' }, 409)

  const [job] = await db
    .insert(import_jobs)
    .values({
      engagement_id: engagementId,
      user_id: userId,
      source: 'sample',
      status: 'processing',
    })
    .returning()

  // Generate 24 months of sales across several states with varied volumes,
  // so some states clearly cross economic-nexus thresholds and others don't.
  const stateProfiles: Array<{ state: string; monthly: number; marketplaceShare: number; categories: string[] }> = [
    { state: 'CA', monthly: 62000, marketplaceShare: 0.15, categories: ['saas', 'services'] },
    { state: 'TX', monthly: 48000, marketplaceShare: 0.1, categories: ['saas', 'hardware'] },
    { state: 'NY', monthly: 41000, marketplaceShare: 0.2, categories: ['saas', 'services'] },
    { state: 'FL', monthly: 22000, marketplaceShare: 0.3, categories: ['hardware'] },
    { state: 'WA', monthly: 17000, marketplaceShare: 0.05, categories: ['saas'] },
    { state: 'IL', monthly: 9000, marketplaceShare: 0.1, categories: ['services'] },
    { state: 'CO', monthly: 5200, marketplaceShare: 0.25, categories: ['saas'] },
    { state: 'PA', monthly: 3100, marketplaceShare: 0.4, categories: ['hardware'] },
  ]

  const asOf = new Date(eng.as_of_date)
  const rows: Array<{
    engagement_id: string
    import_job_id: string
    sale_date: Date
    state: string
    jurisdiction: string
    amount: number
    is_taxable: boolean
    is_marketplace: boolean
    transaction_ref: string
    product_category: string
    exempt_reason: string
  }> = []

  let seq = 0
  // Deterministic pseudo-random so results are stable per engagement.
  let seed = 0
  for (let i = 0; i < engagementId.length; i++) seed = (seed * 31 + engagementId.charCodeAt(i)) >>> 0
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }

  for (let monthsAgo = 23; monthsAgo >= 0; monthsAgo--) {
    const base = new Date(asOf)
    base.setMonth(base.getMonth() - monthsAgo)
    for (const p of stateProfiles) {
      // 8-14 transactions per state per month
      const txns = 8 + Math.floor(rand() * 7)
      for (let t = 0; t < txns; t++) {
        const day = 1 + Math.floor(rand() * 27)
        const saleDate = new Date(base.getFullYear(), base.getMonth(), day)
        // spread the monthly total across the transactions with some jitter
        const avg = p.monthly / txns
        const amount = Math.round(avg * (0.6 + rand() * 0.8) * 100) / 100
        const isMarketplace = rand() < p.marketplaceShare
        const category = p.categories[Math.floor(rand() * p.categories.length)]
        const isTaxable = !(category === 'saas' && rand() < 0.15)
        seq++
        rows.push({
          engagement_id: engagementId,
          import_job_id: job.id,
          sale_date: saleDate,
          state: p.state,
          jurisdiction: '',
          amount,
          is_taxable: isTaxable,
          is_marketplace: isMarketplace,
          transaction_ref: `SAMPLE-${seq}`,
          product_category: category,
          exempt_reason: isTaxable ? '' : 'resale_certificate',
        })
      }
    }
  }

  const chunkSize = 500
  for (let i = 0; i < rows.length; i += chunkSize) {
    await db.insert(sales_lines).values(rows.slice(i, i + chunkSize))
  }

  const [updated] = await db
    .update(import_jobs)
    .set({ status: 'completed', row_count: rows.length, error_count: 0 })
    .where(eq(import_jobs.id, job.id))
    .returning()

  return c.json({ job: updated, inserted: rows.length }, 201)
})

// GET /:engagementId/:jobId/errors — list import errors for a job
router.get('/:engagementId/:jobId/errors', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const engagementId = c.req.param('engagementId')
  const jobId = c.req.param('jobId')
  const { eng, allowed } = await loadOwnedEngagement(engagementId, userId)
  if (!eng) return c.json({ error: 'Engagement not found' }, 404)
  if (!allowed) return c.json({ error: 'Forbidden' }, 403)

  const [job] = await db
    .select()
    .from(import_jobs)
    .where(and(eq(import_jobs.id, jobId), eq(import_jobs.engagement_id, engagementId)))
  if (!job) return c.json({ error: 'Import job not found' }, 404)

  const errors = await db
    .select()
    .from(import_errors)
    .where(eq(import_errors.import_job_id, jobId))
    .orderBy(import_errors.row_number)
  return c.json(errors)
})

export default router
