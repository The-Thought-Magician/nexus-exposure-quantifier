import { db } from './index.js'
import { sql } from 'drizzle-orm'

const statements: string[] = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id text PRIMARY KEY,
    name text NOT NULL,
    owner_id text NOT NULL,
    legal_name text,
    fiscal_year_end text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS workspace_members (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    role text NOT NULL DEFAULT 'member',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
  )`,

  `CREATE TABLE IF NOT EXISTS engagements (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT '',
    as_of_date timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'draft',
    is_locked boolean NOT NULL DEFAULT false,
    total_tax real DEFAULT 0,
    total_penalty real DEFAULT 0,
    total_interest real DEFAULT 0,
    total_exposure real DEFAULT 0,
    total_vda_savings real DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS assumptions (
    id text PRIMARY KEY,
    engagement_id text NOT NULL UNIQUE REFERENCES engagements(id),
    effective_rate_basis text NOT NULL DEFAULT 'library',
    include_marketplace_sales boolean NOT NULL DEFAULT false,
    include_exempt_in_measure boolean NOT NULL DEFAULT true,
    compounding text NOT NULL DEFAULT 'monthly',
    saas_taxable_stance text NOT NULL DEFAULT 'per_state',
    notes text DEFAULT '',
    change_log jsonb DEFAULT '[]'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS import_jobs (
    id text PRIMARY KEY,
    engagement_id text NOT NULL REFERENCES engagements(id),
    user_id text NOT NULL,
    source text NOT NULL DEFAULT 'csv',
    status text NOT NULL DEFAULT 'pending',
    row_count integer DEFAULT 0,
    error_count integer DEFAULT 0,
    column_mapping jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS sales_lines (
    id text PRIMARY KEY,
    engagement_id text NOT NULL REFERENCES engagements(id),
    import_job_id text REFERENCES import_jobs(id),
    sale_date timestamptz NOT NULL,
    state text NOT NULL,
    jurisdiction text DEFAULT '',
    amount real NOT NULL,
    is_taxable boolean NOT NULL DEFAULT true,
    is_marketplace boolean NOT NULL DEFAULT false,
    transaction_ref text DEFAULT '',
    product_category text DEFAULT '',
    exempt_reason text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS import_errors (
    id text PRIMARY KEY,
    import_job_id text NOT NULL REFERENCES import_jobs(id),
    row_number integer NOT NULL,
    message text NOT NULL,
    raw_row jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS state_nexus_rules (
    id text PRIMARY KEY,
    state text NOT NULL,
    sales_threshold real NOT NULL,
    transaction_threshold integer,
    measurement_period text NOT NULL DEFAULT 'rolling_12',
    counts_marketplace boolean NOT NULL DEFAULT true,
    includes_exempt boolean NOT NULL DEFAULT true,
    effective_date timestamptz NOT NULL,
    citation text DEFAULT '',
    notes text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (state, effective_date)
  )`,

  `CREATE TABLE IF NOT EXISTS state_tax_rates (
    id text PRIMARY KEY,
    state text NOT NULL,
    base_rate real NOT NULL,
    avg_combined_rate real NOT NULL,
    effective_date timestamptz NOT NULL,
    filing_frequency text NOT NULL DEFAULT 'monthly',
    notes text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (state, effective_date)
  )`,

  `CREATE TABLE IF NOT EXISTS product_taxability (
    id text PRIMARY KEY,
    engagement_id text NOT NULL REFERENCES engagements(id),
    state text NOT NULL,
    product_category text NOT NULL,
    is_taxable boolean NOT NULL DEFAULT true,
    rate_override real,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (engagement_id, state, product_category)
  )`,

  `CREATE TABLE IF NOT EXISTS state_penalty_rules (
    id text PRIMARY KEY,
    state text NOT NULL,
    failure_to_file_rate real NOT NULL,
    failure_to_pay_rate real NOT NULL,
    penalty_cap_rate real,
    min_penalty real DEFAULT 0,
    accrual text NOT NULL DEFAULT 'monthly',
    effective_date timestamptz NOT NULL,
    notes text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (state, effective_date)
  )`,

  `CREATE TABLE IF NOT EXISTS state_interest_rates (
    id text PRIMARY KEY,
    state text NOT NULL,
    year integer NOT NULL,
    annual_rate real NOT NULL,
    compounding text NOT NULL DEFAULT 'monthly',
    notes text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (state, year)
  )`,

  `CREATE TABLE IF NOT EXISTS state_vda_terms (
    id text PRIMARY KEY,
    state text NOT NULL UNIQUE,
    lookback_years integer NOT NULL DEFAULT 4,
    waives_penalties boolean NOT NULL DEFAULT true,
    interest_treatment text NOT NULL DEFAULT 'full',
    requires_no_prior_contact boolean NOT NULL DEFAULT true,
    notes text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS crossing_results (
    id text PRIMARY KEY,
    engagement_id text NOT NULL REFERENCES engagements(id),
    state text NOT NULL,
    has_crossed boolean NOT NULL DEFAULT false,
    crossing_date timestamptz,
    tripping_test text,
    measure_at_crossing real,
    threshold_used real,
    timeline jsonb DEFAULT '[]'::jsonb,
    computed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (engagement_id, state)
  )`,

  `CREATE TABLE IF NOT EXISTS exposure_lines (
    id text PRIMARY KEY,
    engagement_id text NOT NULL REFERENCES engagements(id),
    state text NOT NULL,
    period text NOT NULL,
    taxable_sales real NOT NULL DEFAULT 0,
    rate_applied real NOT NULL DEFAULT 0,
    tax real NOT NULL DEFAULT 0,
    penalty real NOT NULL DEFAULT 0,
    interest real NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS state_exposures (
    id text PRIMARY KEY,
    engagement_id text NOT NULL REFERENCES engagements(id),
    state text NOT NULL,
    tax real NOT NULL DEFAULT 0,
    penalty real NOT NULL DEFAULT 0,
    interest real NOT NULL DEFAULT 0,
    total real NOT NULL DEFAULT 0,
    vda_tax real NOT NULL DEFAULT 0,
    vda_total real NOT NULL DEFAULT 0,
    vda_savings real NOT NULL DEFAULT 0,
    materiality_band text DEFAULT 'low',
    computed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (engagement_id, state)
  )`,

  `CREATE TABLE IF NOT EXISTS scenarios (
    id text PRIMARY KEY,
    engagement_id text NOT NULL REFERENCES engagements(id),
    kind text NOT NULL,
    wait_months integer DEFAULT 0,
    total_tax real DEFAULT 0,
    total_penalty real DEFAULT 0,
    total_interest real DEFAULT 0,
    total real DEFAULT 0,
    per_state jsonb DEFAULT '[]'::jsonb,
    is_recommended boolean NOT NULL DEFAULT false,
    computed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS memos (
    id text PRIMARY KEY,
    engagement_id text NOT NULL REFERENCES engagements(id),
    user_id text NOT NULL,
    title text NOT NULL,
    scope text NOT NULL DEFAULT 'consolidated',
    state text,
    content jsonb DEFAULT '{"sections":[]}'::jsonb,
    as_of_date timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS remediation_items (
    id text PRIMARY KEY,
    engagement_id text NOT NULL REFERENCES engagements(id),
    user_id text NOT NULL,
    state text NOT NULL,
    status text NOT NULL DEFAULT 'not_started',
    owner text DEFAULT '',
    target_date timestamptz,
    checklist jsonb DEFAULT '[]'::jsonb,
    notes text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (engagement_id, state)
  )`,

  `CREATE TABLE IF NOT EXISTS audit_flags (
    id text PRIMARY KEY,
    engagement_id text NOT NULL REFERENCES engagements(id),
    user_id text NOT NULL,
    state text NOT NULL,
    vda_window text NOT NULL DEFAULT 'open',
    has_prior_contact boolean NOT NULL DEFAULT false,
    notes text DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (engagement_id, state)
  )`,

  `CREATE TABLE IF NOT EXISTS comments (
    id text PRIMARY KEY,
    engagement_id text NOT NULL REFERENCES engagements(id),
    user_id text NOT NULL,
    state text DEFAULT '',
    parent_id text,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS snapshots (
    id text PRIMARY KEY,
    engagement_id text NOT NULL REFERENCES engagements(id),
    user_id text NOT NULL,
    share_token text NOT NULL UNIQUE,
    label text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    workspace_id text REFERENCES workspaces(id),
    kind text NOT NULL,
    title text NOT NULL,
    body text DEFAULT '',
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS activity_log (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    action text NOT NULL,
    target text DEFAULT '',
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL DEFAULT 'free' REFERENCES plans(id),
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
]

const indexes: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_engagements_workspace ON engagements(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_engagements_user ON engagements(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_assumptions_engagement ON assumptions(engagement_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_lines_engagement ON sales_lines(engagement_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_lines_import ON sales_lines(import_job_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_lines_state ON sales_lines(engagement_id, state)`,
  `CREATE INDEX IF NOT EXISTS idx_import_jobs_engagement ON import_jobs(engagement_id)`,
  `CREATE INDEX IF NOT EXISTS idx_import_errors_job ON import_errors(import_job_id)`,
  `CREATE INDEX IF NOT EXISTS idx_state_nexus_rules_state ON state_nexus_rules(state)`,
  `CREATE INDEX IF NOT EXISTS idx_state_tax_rates_state ON state_tax_rates(state)`,
  `CREATE INDEX IF NOT EXISTS idx_product_taxability_engagement ON product_taxability(engagement_id)`,
  `CREATE INDEX IF NOT EXISTS idx_state_penalty_rules_state ON state_penalty_rules(state)`,
  `CREATE INDEX IF NOT EXISTS idx_state_interest_rates_state ON state_interest_rates(state)`,
  `CREATE INDEX IF NOT EXISTS idx_crossing_results_engagement ON crossing_results(engagement_id)`,
  `CREATE INDEX IF NOT EXISTS idx_exposure_lines_engagement ON exposure_lines(engagement_id)`,
  `CREATE INDEX IF NOT EXISTS idx_exposure_lines_state ON exposure_lines(engagement_id, state)`,
  `CREATE INDEX IF NOT EXISTS idx_state_exposures_engagement ON state_exposures(engagement_id)`,
  `CREATE INDEX IF NOT EXISTS idx_scenarios_engagement ON scenarios(engagement_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memos_engagement ON memos(engagement_id)`,
  `CREATE INDEX IF NOT EXISTS idx_remediation_items_engagement ON remediation_items(engagement_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_flags_engagement ON audit_flags(engagement_id)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_engagement ON comments(engagement_id)`,
  `CREATE INDEX IF NOT EXISTS idx_snapshots_engagement ON snapshots(engagement_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_log_workspace ON activity_log(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  for (const stmt of indexes) {
    await db.execute(sql.raw(stmt))
  }
  console.log('Migration complete: tables and indexes provisioned')
}
