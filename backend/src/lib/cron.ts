import { CronExpressionParser } from 'cron-parser'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface Job {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  resourceId?: string
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface Collision {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatBucket {
  bucket: string
  count: number
}

export interface DstTrap {
  type: 'double_fire' | 'skip' | 'ambiguous'
  atLocal: string
  atUtc: string
}

export interface CoverageWindow {
  start: string
  end: string
  requiredEveryMinutes?: number
}

export interface CoverageGap {
  windowStart: string
  windowEnd: string
  gapMinutes: number
  reason: string
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RATE_RE = /^every\s+(\d+)\s+(minute|minutes|hour|hours|day|days)$/i

function parseRate(expr: string): { intervalMs: number; label: string } | null {
  const m = expr.trim().match(RATE_RE)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = m[2].toLowerCase()
  let intervalMs: number
  let label: string
  if (unit.startsWith('minute')) {
    intervalMs = n * 60_000
    label = `every ${n} minute${n === 1 ? '' : 's'}`
  } else if (unit.startsWith('hour')) {
    intervalMs = n * 3_600_000
    label = `every ${n} hour${n === 1 ? '' : 's'}`
  } else {
    intervalMs = n * 86_400_000
    label = `every ${n} day${n === 1 ? '' : 's'}`
  }
  return { intervalMs, label }
}

function toIso(d: Date): string {
  return d.toISOString()
}

/** Offset (in minutes) of a given UTC instant in the target IANA timezone. */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = dtf.formatToParts(date)
    const map: Record<string, number> = {}
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10)
    }
    // Reconstruct the wall-clock time as if it were UTC, then diff from real UTC.
    const asUtc = Date.UTC(
      map.year,
      (map.month ?? 1) - 1,
      map.day ?? 1,
      map.hour === 24 ? 0 : map.hour ?? 0,
      map.minute ?? 0,
      map.second ?? 0,
    )
    return Math.round((asUtc - date.getTime()) / 60_000)
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// validateExpression
// ---------------------------------------------------------------------------

export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  const trimmed = (expr ?? '').trim()
  if (!trimmed) return { valid: false, error: 'Expression is empty' }
  if (kind === 'cron') {
    try {
      CronExpressionParser.parse(trimmed)
      return { valid: true }
    } catch (e) {
      return { valid: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  if (kind === 'rate') {
    const rate = parseRate(trimmed)
    if (!rate) return { valid: false, error: 'Rate must be "every N minutes|hours|days" with N > 0' }
    return { valid: true }
  }
  if (kind === 'oneoff') {
    const t = Date.parse(trimmed)
    if (Number.isNaN(t)) return { valid: false, error: 'One-off must be an ISO date-time string' }
    return { valid: true }
  }
  return { valid: false, error: `Unknown schedule kind: ${kind}` }
}

// ---------------------------------------------------------------------------
// describeExpression
// ---------------------------------------------------------------------------

export function describeExpression(kind: ScheduleKind, expr: string, timezone = 'UTC'): string {
  const check = validateExpression(kind, expr)
  if (!check.valid) return `Invalid ${kind} expression: ${check.error}`
  const trimmed = expr.trim()
  if (kind === 'rate') {
    const rate = parseRate(trimmed)!
    return `Runs ${rate.label} (${timezone})`
  }
  if (kind === 'oneoff') {
    return `Runs once at ${new Date(trimmed).toISOString()} (${timezone})`
  }
  // cron
  const fields = trimmed.split(/\s+/)
  const [min, hour, dom, month, dow] = fields
  const parts: string[] = []
  if (min === '*' && hour === '*') parts.push('every minute')
  else if (min !== '*' && hour === '*') parts.push(`at minute ${min} of every hour`)
  else if (min === '0' && hour !== '*') parts.push(`at ${hour}:00`)
  else parts.push(`at ${hour}:${min.padStart(2, '0')}`)
  if (dom !== '*') parts.push(`on day-of-month ${dom}`)
  if (month !== '*') parts.push(`in month ${month}`)
  if (dow !== '*') parts.push(`on weekday ${dow}`)
  return `Runs ${parts.join(', ')} (${timezone}) [${trimmed}]`
}

// ---------------------------------------------------------------------------
// nextFirings
// ---------------------------------------------------------------------------

export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO?: string,
  count = 10,
): string[] {
  const from = fromISO ? new Date(fromISO) : new Date()
  if (Number.isNaN(from.getTime())) return []
  const n = Math.max(0, Math.min(count, 1000))
  const trimmed = (expr ?? '').trim()

  if (kind === 'oneoff') {
    const t = Date.parse(trimmed)
    if (Number.isNaN(t)) return []
    return t > from.getTime() ? [new Date(t).toISOString()] : []
  }

  if (kind === 'rate') {
    const rate = parseRate(trimmed)
    if (!rate) return []
    const out: string[] = []
    let cursor = from.getTime() + rate.intervalMs
    for (let i = 0; i < n; i++) {
      out.push(new Date(cursor).toISOString())
      cursor += rate.intervalMs
    }
    return out
  }

  // cron
  try {
    const interval = CronExpressionParser.parse(trimmed, {
      tz: timezone,
      currentDate: from,
    })
    const out: string[] = []
    for (let i = 0; i < n; i++) {
      const next = interval.next()
      out.push(next.toDate().toISOString())
    }
    return out
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// computeCollisions
// ---------------------------------------------------------------------------

export function computeCollisions(
  jobs: Job[],
  opts: { horizonDays?: number; threshold?: number } = {},
): Collision[] {
  const horizonDays = opts.horizonDays ?? 7
  const threshold = Math.max(2, opts.threshold ?? 2)
  const from = new Date()
  const horizonMs = horizonDays * 86_400_000
  const cutoff = from.getTime() + horizonMs

  // minute-bucket -> jobIds
  const buckets = new Map<string, { jobIds: Set<string>; resources: Map<string, Set<string>> }>()

  for (const job of jobs) {
    // fetch enough firings to cover the horizon
    const fires = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', from.toISOString(), 1000)
    for (const iso of fires) {
      const t = Date.parse(iso)
      if (t > cutoff) break
      const minuteKey = iso.slice(0, 16) // YYYY-MM-DDTHH:MM
      let b = buckets.get(minuteKey)
      if (!b) {
        b = { jobIds: new Set(), resources: new Map() }
        buckets.set(minuteKey, b)
      }
      b.jobIds.add(job.id)
      if (job.resourceId) {
        let rs = b.resources.get(job.resourceId)
        if (!rs) {
          rs = new Set()
          b.resources.set(job.resourceId, rs)
        }
        rs.add(job.id)
      }
    }
  }

  const collisions: Collision[] = []
  for (const [minuteKey, b] of buckets) {
    const concurrency = b.jobIds.size
    // resource contention: >=2 jobs sharing a resource in this minute
    let contendedResource: string | undefined
    let contendedJobs: string[] | undefined
    for (const [resId, rs] of b.resources) {
      if (rs.size >= 2) {
        contendedResource = resId
        contendedJobs = [...rs]
        break
      }
    }
    if (concurrency >= threshold || contendedResource) {
      const windowStart = new Date(`${minuteKey}:00.000Z`).toISOString()
      const windowEnd = new Date(Date.parse(windowStart) + 60_000).toISOString()
      const jobIds = contendedJobs ?? [...b.jobIds]
      let severity: Collision['severity'] = 'low'
      if (concurrency >= threshold + 3 || (contendedResource && concurrency >= threshold)) severity = 'high'
      else if (concurrency >= threshold + 1) severity = 'medium'
      collisions.push({
        windowStart,
        windowEnd,
        jobIds,
        severity,
        resourceId: contendedResource,
      })
    }
  }
  collisions.sort((a, b) => a.windowStart.localeCompare(b.windowStart))
  return collisions
}

// ---------------------------------------------------------------------------
// loadHeatmap
// ---------------------------------------------------------------------------

export function loadHeatmap(jobs: Job[], opts: { horizonDays?: number } = {}): HeatBucket[] {
  const horizonDays = opts.horizonDays ?? 7
  const from = new Date()
  const cutoff = from.getTime() + horizonDays * 86_400_000
  // bucket by hour
  const counts = new Map<string, number>()
  for (const job of jobs) {
    const fires = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', from.toISOString(), 5000)
    for (const iso of fires) {
      const t = Date.parse(iso)
      if (t > cutoff) break
      const hourKey = `${iso.slice(0, 13)}:00` // YYYY-MM-DDTHH:00
      counts.set(hourKey, (counts.get(hourKey) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
}

// ---------------------------------------------------------------------------
// dstTraps
// ---------------------------------------------------------------------------

export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO?: string,
  days = 365,
): DstTrap[] {
  if (timezone === 'UTC') return []
  const from = fromISO ? new Date(fromISO) : new Date()
  if (Number.isNaN(from.getTime())) return []
  const traps: DstTrap[] = []

  // Walk hour by hour, detect offset transitions.
  const stepMs = 3_600_000
  const total = days * 24
  let prevOffset = tzOffsetMinutes(from, timezone)
  const transitions: Array<{ at: number; before: number; after: number }> = []
  for (let i = 1; i <= total; i++) {
    const at = from.getTime() + i * stepMs
    const off = tzOffsetMinutes(new Date(at), timezone)
    if (off !== prevOffset) {
      transitions.push({ at, before: prevOffset, after: off })
      prevOffset = off
    }
  }

  // For each transition, determine the affected local wall-clock window and
  // check whether the schedule fires there.
  const fires = nextFirings(kind, expr, timezone, from.toISOString(), 20000)
  const fireSet = fires.map((f) => Date.parse(f))

  for (const tr of transitions) {
    const gained = tr.after > tr.before // clocks spring forward => skip; fall back => double/ambiguous
    // Window boundaries around the transition (the transition happens at tr.at UTC).
    const windowStart = tr.at - stepMs
    const windowEnd = tr.at + stepMs
    if (gained) {
      // spring forward: a local hour is skipped. A scheduled fire that would
      // land in the skipped local window is a 'skip'.
      const hit = fireSet.find((t) => t >= windowStart && t < windowEnd)
      if (hit !== undefined) {
        const d = new Date(hit)
        traps.push({
          type: 'skip',
          atLocal: localString(d, timezone),
          atUtc: d.toISOString(),
        })
      }
    } else {
      // fall back: a local hour repeats. A scheduled fire in the repeated
      // window is ambiguous / can double-fire.
      const hits = fireSet.filter((t) => t >= windowStart && t < windowEnd)
      if (hits.length >= 2) {
        const d = new Date(hits[0])
        traps.push({
          type: 'double_fire',
          atLocal: localString(d, timezone),
          atUtc: d.toISOString(),
        })
      } else if (hits.length === 1) {
        const d = new Date(hits[0])
        traps.push({
          type: 'ambiguous',
          atLocal: localString(d, timezone),
          atUtc: d.toISOString(),
        })
      }
    }
  }
  return traps
}

function localString(d: Date, timeZone: string): string {
  try {
    const dtf = new Intl.DateTimeFormat('sv-SE', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    return dtf.format(d).replace(' ', 'T')
  } catch {
    return d.toISOString()
  }
}

// ---------------------------------------------------------------------------
// coverageGaps
// ---------------------------------------------------------------------------

export function coverageGaps(
  windows: CoverageWindow[],
  jobs: Job[],
  opts: { horizonDays?: number } = {},
): CoverageGap[] {
  const horizonDays = opts.horizonDays ?? 7
  const from = new Date()
  const cutoff = from.getTime() + horizonDays * 86_400_000

  // Collect all firing instants within horizon.
  const allFires: number[] = []
  for (const job of jobs) {
    const fires = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', from.toISOString(), 5000)
    for (const iso of fires) {
      const t = Date.parse(iso)
      if (t > cutoff) break
      allFires.push(t)
    }
  }
  allFires.sort((a, b) => a - b)

  const gaps: CoverageGap[] = []
  for (const w of windows) {
    const wStart = Date.parse(w.start)
    const wEnd = Date.parse(w.end)
    if (Number.isNaN(wStart) || Number.isNaN(wEnd) || wEnd <= wStart) continue
    const requiredMs = (w.requiredEveryMinutes ?? 60) * 60_000
    const inWindow = allFires.filter((t) => t >= wStart && t <= wEnd)

    // Boundaries to walk: window start, each fire, window end.
    const points = [wStart, ...inWindow, wEnd]
    for (let i = 0; i < points.length - 1; i++) {
      const gapMs = points[i + 1] - points[i]
      if (gapMs > requiredMs) {
        gaps.push({
          windowStart: new Date(points[i]).toISOString(),
          windowEnd: new Date(points[i + 1]).toISOString(),
          gapMinutes: Math.round(gapMs / 60_000),
          reason:
            inWindow.length === 0
              ? 'No scheduled runs cover this window'
              : `Gap exceeds required cadence of ${w.requiredEveryMinutes ?? 60} minute(s)`,
        })
      }
    }
  }
  return gaps
}

// ---------------------------------------------------------------------------
// autoSpread
// ---------------------------------------------------------------------------

export function autoSpread(
  jobs: Job[],
  opts: { threshold?: number } = {},
): SpreadSuggestion[] {
  const threshold = Math.max(2, opts.threshold ?? 2)
  const collisions = computeCollisions(jobs, { threshold })
  if (collisions.length === 0) return []

  // Rank jobs by how many collision windows they participate in.
  const involvement = new Map<string, number>()
  for (const col of collisions) {
    for (const id of col.jobIds) {
      involvement.set(id, (involvement.get(id) ?? 0) + 1)
    }
  }

  const jobsById = new Map(jobs.map((j) => [j.id, j]))
  const suggestions: SpreadSuggestion[] = []
  // Deterministic offset assignment: stagger the most-involved jobs by minute.
  const ranked = [...involvement.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    return a[0].localeCompare(b[0])
  })

  let offset = 1
  for (const [jobId, hits] of ranked) {
    const job = jobsById.get(jobId)
    if (!job) continue
    const suggested = shiftExpr(job, offset)
    if (suggested && suggested !== job.expr) {
      suggestions.push({
        jobId,
        suggestedExpr: suggested,
        reason: `Participates in ${hits} collision window(s); staggering by ${offset} minute(s) to spread load`,
      })
      offset = (offset % 59) + 1
    }
  }
  return suggestions
}

/** Deterministically shift a cron minute field (or rate) to spread load. */
function shiftExpr(job: Job, offsetMinutes: number): string | null {
  if (job.kind === 'cron') {
    const fields = job.expr.trim().split(/\s+/)
    if (fields.length < 5) return null
    const minField = fields[0]
    // Only shift when minute is a fixed single value.
    if (/^\d+$/.test(minField)) {
      const newMin = (parseInt(minField, 10) + offsetMinutes) % 60
      fields[0] = String(newMin)
      return fields.join(' ')
    }
    if (minField === '0') {
      fields[0] = String(offsetMinutes % 60)
      return fields.join(' ')
    }
    return null
  }
  if (job.kind === 'rate') {
    // Rates cannot carry a phase offset; leave unchanged.
    return null
  }
  return null
}
