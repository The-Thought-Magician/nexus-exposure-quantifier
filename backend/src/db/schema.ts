import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  owner_id: text('owner_id').notNull(),
  legal_name: text('legal_name'),
  fiscal_year_end: text('fiscal_year_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const workspace_members = pgTable('workspace_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  role: text('role').notNull().default('member'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.user_id)])

// ---------------------------------------------------------------------------
// Engagements
// ---------------------------------------------------------------------------

export const engagements = pgTable('engagements', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  description: text('description').default(''),
  as_of_date: timestamp('as_of_date').notNull(),
  status: text('status').notNull().default('draft'),
  is_locked: boolean('is_locked').default(false).notNull(),
  total_tax: real('total_tax').default(0),
  total_penalty: real('total_penalty').default(0),
  total_interest: real('total_interest').default(0),
  total_exposure: real('total_exposure').default(0),
  total_vda_savings: real('total_vda_savings').default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const assumptions = pgTable('assumptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  engagement_id: text('engagement_id').notNull().references(() => engagements.id).unique(),
  effective_rate_basis: text('effective_rate_basis').notNull().default('library'),
  include_marketplace_sales: boolean('include_marketplace_sales').default(false).notNull(),
  include_exempt_in_measure: boolean('include_exempt_in_measure').default(true).notNull(),
  compounding: text('compounding').notNull().default('monthly'),
  saas_taxable_stance: text('saas_taxable_stance').notNull().default('per_state'),
  notes: text('notes').default(''),
  change_log: jsonb('change_log').$type<Array<{ at: string; user_id: string; field: string; from: string; to: string }>>().default([]),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Sales ingestion
// ---------------------------------------------------------------------------

export const sales_lines = pgTable('sales_lines', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  engagement_id: text('engagement_id').notNull().references(() => engagements.id),
  import_job_id: text('import_job_id').references(() => import_jobs.id),
  sale_date: timestamp('sale_date').notNull(),
  state: text('state').notNull(),
  jurisdiction: text('jurisdiction').default(''),
  amount: real('amount').notNull(),
  is_taxable: boolean('is_taxable').default(true).notNull(),
  is_marketplace: boolean('is_marketplace').default(false).notNull(),
  transaction_ref: text('transaction_ref').default(''),
  product_category: text('product_category').default(''),
  exempt_reason: text('exempt_reason').default(''),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const import_jobs = pgTable('import_jobs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  engagement_id: text('engagement_id').notNull().references(() => engagements.id),
  user_id: text('user_id').notNull(),
  source: text('source').notNull().default('csv'),
  status: text('status').notNull().default('pending'),
  row_count: integer('row_count').default(0),
  error_count: integer('error_count').default(0),
  column_mapping: jsonb('column_mapping').$type<Record<string, string>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const import_errors = pgTable('import_errors', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  import_job_id: text('import_job_id').notNull().references(() => import_jobs.id),
  row_number: integer('row_number').notNull(),
  message: text('message').notNull(),
  raw_row: jsonb('raw_row').$type<Record<string, string>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Reference libraries (public read)
// ---------------------------------------------------------------------------

export const state_nexus_rules = pgTable('state_nexus_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  state: text('state').notNull(),
  sales_threshold: real('sales_threshold').notNull(),
  transaction_threshold: integer('transaction_threshold'),
  measurement_period: text('measurement_period').notNull().default('rolling_12'),
  counts_marketplace: boolean('counts_marketplace').default(true).notNull(),
  includes_exempt: boolean('includes_exempt').default(true).notNull(),
  effective_date: timestamp('effective_date').notNull(),
  citation: text('citation').default(''),
  notes: text('notes').default(''),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.state, t.effective_date)])

export const state_tax_rates = pgTable('state_tax_rates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  state: text('state').notNull(),
  base_rate: real('base_rate').notNull(),
  avg_combined_rate: real('avg_combined_rate').notNull(),
  effective_date: timestamp('effective_date').notNull(),
  filing_frequency: text('filing_frequency').notNull().default('monthly'),
  notes: text('notes').default(''),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.state, t.effective_date)])

export const product_taxability = pgTable('product_taxability', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  engagement_id: text('engagement_id').notNull().references(() => engagements.id),
  state: text('state').notNull(),
  product_category: text('product_category').notNull(),
  is_taxable: boolean('is_taxable').default(true).notNull(),
  rate_override: real('rate_override'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.engagement_id, t.state, t.product_category)])

export const state_penalty_rules = pgTable('state_penalty_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  state: text('state').notNull(),
  failure_to_file_rate: real('failure_to_file_rate').notNull(),
  failure_to_pay_rate: real('failure_to_pay_rate').notNull(),
  penalty_cap_rate: real('penalty_cap_rate'),
  min_penalty: real('min_penalty').default(0),
  accrual: text('accrual').notNull().default('monthly'),
  effective_date: timestamp('effective_date').notNull(),
  notes: text('notes').default(''),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.state, t.effective_date)])

export const state_interest_rates = pgTable('state_interest_rates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  state: text('state').notNull(),
  year: integer('year').notNull(),
  annual_rate: real('annual_rate').notNull(),
  compounding: text('compounding').notNull().default('monthly'),
  notes: text('notes').default(''),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.state, t.year)])

export const state_vda_terms = pgTable('state_vda_terms', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  state: text('state').notNull().unique(),
  lookback_years: integer('lookback_years').notNull().default(4),
  waives_penalties: boolean('waives_penalties').default(true).notNull(),
  interest_treatment: text('interest_treatment').notNull().default('full'),
  requires_no_prior_contact: boolean('requires_no_prior_contact').default(true).notNull(),
  notes: text('notes').default(''),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Computed results
// ---------------------------------------------------------------------------

export const crossing_results = pgTable('crossing_results', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  engagement_id: text('engagement_id').notNull().references(() => engagements.id),
  state: text('state').notNull(),
  has_crossed: boolean('has_crossed').default(false).notNull(),
  crossing_date: timestamp('crossing_date'),
  tripping_test: text('tripping_test'),
  measure_at_crossing: real('measure_at_crossing'),
  threshold_used: real('threshold_used'),
  timeline: jsonb('timeline').$type<Array<{ period: string; sales: number; txns: number; running_sales: number; running_txns: number }>>().default([]),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.engagement_id, t.state)])

export const exposure_lines = pgTable('exposure_lines', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  engagement_id: text('engagement_id').notNull().references(() => engagements.id),
  state: text('state').notNull(),
  period: text('period').notNull(),
  taxable_sales: real('taxable_sales').notNull().default(0),
  rate_applied: real('rate_applied').notNull().default(0),
  tax: real('tax').notNull().default(0),
  penalty: real('penalty').notNull().default(0),
  interest: real('interest').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const state_exposures = pgTable('state_exposures', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  engagement_id: text('engagement_id').notNull().references(() => engagements.id),
  state: text('state').notNull(),
  tax: real('tax').notNull().default(0),
  penalty: real('penalty').notNull().default(0),
  interest: real('interest').notNull().default(0),
  total: real('total').notNull().default(0),
  vda_tax: real('vda_tax').notNull().default(0),
  vda_total: real('vda_total').notNull().default(0),
  vda_savings: real('vda_savings').notNull().default(0),
  materiality_band: text('materiality_band').default('low'),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.engagement_id, t.state)])

export const scenarios = pgTable('scenarios', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  engagement_id: text('engagement_id').notNull().references(() => engagements.id),
  kind: text('kind').notNull(),
  wait_months: integer('wait_months').default(0),
  total_tax: real('total_tax').default(0),
  total_penalty: real('total_penalty').default(0),
  total_interest: real('total_interest').default(0),
  total: real('total').default(0),
  per_state: jsonb('per_state').$type<Array<{ state: string; tax: number; penalty: number; interest: number; total: number }>>().default([]),
  is_recommended: boolean('is_recommended').default(false).notNull(),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const memos = pgTable('memos', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  engagement_id: text('engagement_id').notNull().references(() => engagements.id),
  user_id: text('user_id').notNull(),
  title: text('title').notNull(),
  scope: text('scope').notNull().default('consolidated'),
  state: text('state'),
  content: jsonb('content').$type<{ sections: Array<{ heading: string; body: string }> }>().default({ sections: [] }),
  as_of_date: timestamp('as_of_date').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const remediation_items = pgTable('remediation_items', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  engagement_id: text('engagement_id').notNull().references(() => engagements.id),
  user_id: text('user_id').notNull(),
  state: text('state').notNull(),
  status: text('status').notNull().default('not_started'),
  owner: text('owner').default(''),
  target_date: timestamp('target_date'),
  checklist: jsonb('checklist').$type<Array<{ label: string; done: boolean }>>().default([]),
  notes: text('notes').default(''),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [unique().on(t.engagement_id, t.state)])

export const audit_flags = pgTable('audit_flags', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  engagement_id: text('engagement_id').notNull().references(() => engagements.id),
  user_id: text('user_id').notNull(),
  state: text('state').notNull(),
  vda_window: text('vda_window').notNull().default('open'),
  has_prior_contact: boolean('has_prior_contact').default(false).notNull(),
  notes: text('notes').default(''),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [unique().on(t.engagement_id, t.state)])

export const comments = pgTable('comments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  engagement_id: text('engagement_id').notNull().references(() => engagements.id),
  user_id: text('user_id').notNull(),
  state: text('state').default(''),
  parent_id: text('parent_id'),
  body: text('body').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const snapshots = pgTable('snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  engagement_id: text('engagement_id').notNull().references(() => engagements.id),
  user_id: text('user_id').notNull(),
  share_token: text('share_token').notNull().unique(),
  label: text('label').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  workspace_id: text('workspace_id').references(() => workspaces.id),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body').default(''),
  is_read: boolean('is_read').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const activity_log = pgTable('activity_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  action: text('action').notNull(),
  target: text('target').default(''),
  meta: jsonb('meta').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free').references(() => plans.id),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
