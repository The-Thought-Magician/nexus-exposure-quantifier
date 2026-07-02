import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import {
  plans,
  state_nexus_rules,
  state_tax_rates,
  state_penalty_rules,
  state_interest_rates,
  state_vda_terms,
} from './db/schema.js'

import workspacesRoutes from './routes/workspaces.js'
import engagementsRoutes from './routes/engagements.js'
import assumptionsRoutes from './routes/assumptions.js'
import salesRoutes from './routes/sales.js'
import importsRoutes from './routes/imports.js'
import nexusRulesRoutes from './routes/nexus-rules.js'
import taxRatesRoutes from './routes/tax-rates.js'
import taxabilityRoutes from './routes/taxability.js'
import penaltyRulesRoutes from './routes/penalty-rules.js'
import interestRatesRoutes from './routes/interest-rates.js'
import vdaTermsRoutes from './routes/vda-terms.js'
import crossingsRoutes from './routes/crossings.js'
import exposureRoutes from './routes/exposure.js'
import scenariosRoutes from './routes/scenarios.js'
import materialityRoutes from './routes/materiality.js'
import memosRoutes from './routes/memos.js'
import remediationRoutes from './routes/remediation.js'
import auditFlagsRoutes from './routes/audit-flags.js'
import waitCostRoutes from './routes/wait-cost.js'
import reportsRoutes from './routes/reports.js'
import commentsRoutes from './routes/comments.js'
import snapshotsRoutes from './routes/snapshots.js'
import notificationsRoutes from './routes/notifications.js'
import activityRoutes from './routes/activity.js'
import analyticsRoutes from './routes/analytics.js'
import billingRoutes from './routes/billing.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://nexus-exposure-quantifier.vercel.app',
]

app.use('*', cors({
  origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
  credentials: true,
}))

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const seedPlans = [
  { id: 'free', name: 'Free', price_cents: 0 },
  { id: 'pro', name: 'Pro', price_cents: 4900 },
]

const EFF = new Date('2019-01-01T00:00:00.000Z')

const seedNexusRules = [
  { state: 'CA', sales_threshold: 500000, transaction_threshold: null, measurement_period: 'rolling_12', counts_marketplace: true, includes_exempt: false, effective_date: EFF, citation: 'Cal. Rev. & Tax. Code 6203', notes: '' },
  { state: 'NY', sales_threshold: 500000, transaction_threshold: 100, measurement_period: 'rolling_4q', counts_marketplace: true, includes_exempt: true, effective_date: EFF, citation: 'N.Y. Tax Law 1101(b)(8)', notes: 'Both thresholds required' },
  { state: 'TX', sales_threshold: 500000, transaction_threshold: null, measurement_period: 'rolling_12', counts_marketplace: true, includes_exempt: true, effective_date: EFF, citation: '34 Tex. Admin. Code 3.286', notes: '' },
  { state: 'WA', sales_threshold: 100000, transaction_threshold: null, measurement_period: 'calendar_year', counts_marketplace: true, includes_exempt: true, effective_date: EFF, citation: 'RCW 82.08.052', notes: '' },
  { state: 'CO', sales_threshold: 100000, transaction_threshold: null, measurement_period: 'calendar_year', counts_marketplace: true, includes_exempt: true, effective_date: EFF, citation: 'Colo. Rev. Stat. 39-26-102', notes: '' },
  { state: 'IL', sales_threshold: 100000, transaction_threshold: 200, measurement_period: 'rolling_12', counts_marketplace: false, includes_exempt: true, effective_date: EFF, citation: '35 ILCS 105/2', notes: 'Either threshold' },
  { state: 'FL', sales_threshold: 100000, transaction_threshold: null, measurement_period: 'calendar_year', counts_marketplace: false, includes_exempt: false, effective_date: EFF, citation: 'Fla. Stat. 212.0596', notes: '' },
  { state: 'GA', sales_threshold: 100000, transaction_threshold: 200, measurement_period: 'calendar_year', counts_marketplace: true, includes_exempt: true, effective_date: EFF, citation: 'O.C.G.A. 48-8-2', notes: 'Either threshold' },
  { state: 'PA', sales_threshold: 100000, transaction_threshold: null, measurement_period: 'rolling_12', counts_marketplace: true, includes_exempt: true, effective_date: EFF, citation: '72 P.S. 7213.1', notes: '' },
  { state: 'MA', sales_threshold: 100000, transaction_threshold: null, measurement_period: 'calendar_year', counts_marketplace: true, includes_exempt: true, effective_date: EFF, citation: '830 CMR 64H.1.7', notes: '' },
]

const seedTaxRates = [
  { state: 'CA', base_rate: 0.0725, avg_combined_rate: 0.0882, effective_date: EFF, filing_frequency: 'monthly', notes: '' },
  { state: 'NY', base_rate: 0.04, avg_combined_rate: 0.0852, effective_date: EFF, filing_frequency: 'quarterly', notes: '' },
  { state: 'TX', base_rate: 0.0625, avg_combined_rate: 0.0820, effective_date: EFF, filing_frequency: 'monthly', notes: '' },
  { state: 'WA', base_rate: 0.065, avg_combined_rate: 0.0929, effective_date: EFF, filing_frequency: 'monthly', notes: '' },
  { state: 'CO', base_rate: 0.029, avg_combined_rate: 0.0777, effective_date: EFF, filing_frequency: 'monthly', notes: '' },
  { state: 'IL', base_rate: 0.0625, avg_combined_rate: 0.0882, effective_date: EFF, filing_frequency: 'monthly', notes: '' },
  { state: 'FL', base_rate: 0.06, avg_combined_rate: 0.0702, effective_date: EFF, filing_frequency: 'monthly', notes: '' },
  { state: 'GA', base_rate: 0.04, avg_combined_rate: 0.0735, effective_date: EFF, filing_frequency: 'monthly', notes: '' },
  { state: 'PA', base_rate: 0.06, avg_combined_rate: 0.0634, effective_date: EFF, filing_frequency: 'monthly', notes: '' },
  { state: 'MA', base_rate: 0.0625, avg_combined_rate: 0.0625, effective_date: EFF, filing_frequency: 'monthly', notes: '' },
]

const seedPenaltyRules = [
  { state: 'CA', failure_to_file_rate: 0.05, failure_to_pay_rate: 0.005, penalty_cap_rate: 0.25, min_penalty: 0, accrual: 'monthly', effective_date: EFF, notes: '' },
  { state: 'NY', failure_to_file_rate: 0.05, failure_to_pay_rate: 0.005, penalty_cap_rate: 0.25, min_penalty: 50, accrual: 'monthly', effective_date: EFF, notes: '' },
  { state: 'TX', failure_to_file_rate: 0.05, failure_to_pay_rate: 0.05, penalty_cap_rate: 0.10, min_penalty: 0, accrual: 'flat', effective_date: EFF, notes: '' },
  { state: 'WA', failure_to_file_rate: 0.05, failure_to_pay_rate: 0.05, penalty_cap_rate: 0.29, min_penalty: 0, accrual: 'tiered', effective_date: EFF, notes: '' },
  { state: 'CO', failure_to_file_rate: 0.10, failure_to_pay_rate: 0.005, penalty_cap_rate: 0.18, min_penalty: 15, accrual: 'monthly', effective_date: EFF, notes: '' },
  { state: 'IL', failure_to_file_rate: 0.02, failure_to_pay_rate: 0.02, penalty_cap_rate: 0.20, min_penalty: 0, accrual: 'tiered', effective_date: EFF, notes: '' },
  { state: 'FL', failure_to_file_rate: 0.10, failure_to_pay_rate: 0.10, penalty_cap_rate: 0.50, min_penalty: 50, accrual: 'monthly', effective_date: EFF, notes: '' },
  { state: 'GA', failure_to_file_rate: 0.05, failure_to_pay_rate: 0.005, penalty_cap_rate: 0.25, min_penalty: 0, accrual: 'monthly', effective_date: EFF, notes: '' },
  { state: 'PA', failure_to_file_rate: 0.05, failure_to_pay_rate: 0.05, penalty_cap_rate: 0.25, min_penalty: 0, accrual: 'monthly', effective_date: EFF, notes: '' },
  { state: 'MA', failure_to_file_rate: 0.01, failure_to_pay_rate: 0.01, penalty_cap_rate: 0.25, min_penalty: 0, accrual: 'monthly', effective_date: EFF, notes: '' },
]

const seedInterestRates = [
  ...['CA', 'NY', 'TX', 'WA', 'CO', 'IL', 'FL', 'GA', 'PA', 'MA'].flatMap((state) =>
    [2021, 2022, 2023, 2024, 2025].map((year) => ({
      state,
      year,
      annual_rate: year >= 2023 ? 0.08 : 0.05,
      compounding: 'monthly',
      notes: '',
    })),
  ),
]

const seedVdaTerms = [
  { state: 'CA', lookback_years: 3, waives_penalties: true, interest_treatment: 'full', requires_no_prior_contact: true, notes: '' },
  { state: 'NY', lookback_years: 3, waives_penalties: true, interest_treatment: 'full', requires_no_prior_contact: true, notes: '' },
  { state: 'TX', lookback_years: 4, waives_penalties: true, interest_treatment: 'full', requires_no_prior_contact: true, notes: '' },
  { state: 'WA', lookback_years: 4, waives_penalties: true, interest_treatment: 'partial', requires_no_prior_contact: true, notes: '' },
  { state: 'CO', lookback_years: 3, waives_penalties: true, interest_treatment: 'full', requires_no_prior_contact: true, notes: '' },
  { state: 'IL', lookback_years: 4, waives_penalties: true, interest_treatment: 'full', requires_no_prior_contact: true, notes: '' },
  { state: 'FL', lookback_years: 3, waives_penalties: true, interest_treatment: 'full', requires_no_prior_contact: true, notes: '' },
  { state: 'GA', lookback_years: 3, waives_penalties: true, interest_treatment: 'full', requires_no_prior_contact: true, notes: '' },
  { state: 'PA', lookback_years: 3, waives_penalties: true, interest_treatment: 'full', requires_no_prior_contact: true, notes: '' },
  { state: 'MA', lookback_years: 3, waives_penalties: true, interest_treatment: 'full', requires_no_prior_contact: true, notes: '' },
]

async function seedIfEmpty() {
  try {
    const existingPlans = await db.select().from(plans).limit(1)
    if (existingPlans.length === 0) {
      for (const p of seedPlans) await db.insert(plans).values(p as any)
      console.log('Seeded plans')
    }

    const existingNexus = await db.select().from(state_nexus_rules).limit(1)
    if (existingNexus.length === 0) {
      for (const r of seedNexusRules) await db.insert(state_nexus_rules).values(r as any)
      console.log('Seeded nexus rules')
    }

    const existingRates = await db.select().from(state_tax_rates).limit(1)
    if (existingRates.length === 0) {
      for (const r of seedTaxRates) await db.insert(state_tax_rates).values(r as any)
      console.log('Seeded tax rates')
    }

    const existingPenalty = await db.select().from(state_penalty_rules).limit(1)
    if (existingPenalty.length === 0) {
      for (const r of seedPenaltyRules) await db.insert(state_penalty_rules).values(r as any)
      console.log('Seeded penalty rules')
    }

    const existingInterest = await db.select().from(state_interest_rates).limit(1)
    if (existingInterest.length === 0) {
      for (const r of seedInterestRates) await db.insert(state_interest_rates).values(r as any)
      console.log('Seeded interest rates')
    }

    const existingVda = await db.select().from(state_vda_terms).limit(1)
    if (existingVda.length === 0) {
      for (const r of seedVdaTerms) await db.insert(state_vda_terms).values(r as any)
      console.log('Seeded VDA terms')
    }
  } catch (e) {
    console.error('Seed error:', e)
  }
}

// ---------------------------------------------------------------------------
// Router mounting
// ---------------------------------------------------------------------------

const api = new Hono()
api.route('/workspaces', workspacesRoutes)
api.route('/engagements', engagementsRoutes)
api.route('/assumptions', assumptionsRoutes)
api.route('/sales', salesRoutes)
api.route('/imports', importsRoutes)
api.route('/nexus-rules', nexusRulesRoutes)
api.route('/tax-rates', taxRatesRoutes)
api.route('/taxability', taxabilityRoutes)
api.route('/penalty-rules', penaltyRulesRoutes)
api.route('/interest-rates', interestRatesRoutes)
api.route('/vda-terms', vdaTermsRoutes)
api.route('/crossings', crossingsRoutes)
api.route('/exposure', exposureRoutes)
api.route('/scenarios', scenariosRoutes)
api.route('/materiality', materialityRoutes)
api.route('/memos', memosRoutes)
api.route('/remediation', remediationRoutes)
api.route('/audit-flags', auditFlagsRoutes)
api.route('/wait-cost', waitCostRoutes)
api.route('/reports', reportsRoutes)
api.route('/comments', commentsRoutes)
api.route('/snapshots', snapshotsRoutes)
api.route('/notifications', notificationsRoutes)
api.route('/activity', activityRoutes)
api.route('/analytics', analyticsRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

// ---------------------------------------------------------------------------
// Boot: serve() FIRST so the platform health check sees a live port
// immediately, THEN run migrate() and seedIfEmpty() (both idempotent).
// ---------------------------------------------------------------------------

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (process kept alive):', reason)
})
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (process kept alive):', err)
})

const port = parseInt(process.env.PORT ?? '3001')
serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

;(async () => {
  try {
    await migrate()
  } catch (e) {
    console.error('Migrate error:', e)
  }
  try {
    await seedIfEmpty()
  } catch (e) {
    console.error('Seed error:', e)
  }
})()

export default app
