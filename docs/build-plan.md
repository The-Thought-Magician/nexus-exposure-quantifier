# NexusExposureQuantifier — Build Contract (Single Source of Truth)

Every other agent MUST follow this document exactly. Filenames, mount paths, api method names, and page files declared here are binding.

Stack (from `_template-report.md`): Hono 4.12.27 backend, drizzle-orm 0.45.2 + `@neondatabase/serverless` (neon-http), Next.js ^16.2.9 / React ^19.1.0 / Tailwind ^4.1.8, auth `@neondatabase/auth` 0.4.2-beta. Backend trusts `X-User-Id`; use `getUserId(c)`. Routes mount under `/api/v1` via child Hono `api` router. Every route file `export default router`. Public reads / auth-gated writes with zod + ownership checks. Frontend calls `fetch('/api/proxy/<path>')` mapping 1:1 to `/api/v1/<path>`. `web/proxy.ts` only (NO middleware.ts). Auth pages use client onSubmit + authClient. Landing page purely static.

Billing: full Stripe-optional-503 pattern (webhook-inspector billing.ts). `plans` seeded `free`/`pro`; `subscriptions` with text `plan_id`, `stripe_customer_id`, `stripe_subscription_id`, `status`, `current_period_end`, `updated_at`.

Ownership model: every engagement-scoped write verifies the engagement's `user_id` (or workspace membership) matches `getUserId(c)`. Reference libraries (`nexus-rules`, `tax-rates`, `penalty-rules`, `interest-rates`, `vda-terms`) are public reads, admin-gated writes (`ADMIN_USER_IDS`).

---

## (a) Tables (columns)

Full column definitions are authoritative in `backend/src/db/schema.ts` and mirrored in `backend/src/db/migrate.ts`. Summary:

- **workspaces** — id, name, owner_id, legal_name, fiscal_year_end, created_at.
- **workspace_members** — id, workspace_id→workspaces, user_id, role, created_at. UNIQUE(workspace_id, user_id).
- **engagements** — id, workspace_id→workspaces, user_id, name, description, as_of_date, status, is_locked, total_tax, total_penalty, total_interest, total_exposure, total_vda_savings, created_at, updated_at.
- **assumptions** — id, engagement_id→engagements (UNIQUE), effective_rate_basis, include_marketplace_sales, include_exempt_in_measure, compounding, saas_taxable_stance, notes, change_log(jsonb), updated_at, created_at.
- **sales_lines** — id, engagement_id→engagements, import_job_id→import_jobs, sale_date, state, jurisdiction, amount, is_taxable, is_marketplace, transaction_ref, product_category, exempt_reason, created_at.
- **import_jobs** — id, engagement_id→engagements, user_id, source, status, row_count, error_count, column_mapping(jsonb), created_at.
- **import_errors** — id, import_job_id→import_jobs, row_number, message, raw_row(jsonb), created_at.
- **state_nexus_rules** — id, state, sales_threshold, transaction_threshold, measurement_period, counts_marketplace, includes_exempt, effective_date, citation, notes, created_at. UNIQUE(state, effective_date).
- **state_tax_rates** — id, state, base_rate, avg_combined_rate, effective_date, filing_frequency, notes, created_at. UNIQUE(state, effective_date).
- **product_taxability** — id, engagement_id→engagements, state, product_category, is_taxable, rate_override, created_at. UNIQUE(engagement_id, state, product_category).
- **state_penalty_rules** — id, state, failure_to_file_rate, failure_to_pay_rate, penalty_cap_rate, min_penalty, accrual, effective_date, notes, created_at. UNIQUE(state, effective_date).
- **state_interest_rates** — id, state, year, annual_rate, compounding, notes, created_at. UNIQUE(state, year).
- **state_vda_terms** — id, state(UNIQUE), lookback_years, waives_penalties, interest_treatment, requires_no_prior_contact, notes, created_at.
- **crossing_results** — id, engagement_id→engagements, state, has_crossed, crossing_date, tripping_test, measure_at_crossing, threshold_used, timeline(jsonb), computed_at, created_at. UNIQUE(engagement_id, state).
- **exposure_lines** — id, engagement_id→engagements, state, period, taxable_sales, rate_applied, tax, penalty, interest, created_at.
- **state_exposures** — id, engagement_id→engagements, state, tax, penalty, interest, total, vda_tax, vda_total, vda_savings, materiality_band, computed_at, created_at. UNIQUE(engagement_id, state).
- **scenarios** — id, engagement_id→engagements, kind, wait_months, total_tax, total_penalty, total_interest, total, per_state(jsonb), is_recommended, computed_at, created_at.
- **memos** — id, engagement_id→engagements, user_id, title, scope, state, content(jsonb), as_of_date, created_at.
- **remediation_items** — id, engagement_id→engagements, user_id, state, status, owner, target_date, checklist(jsonb), notes, created_at, updated_at. UNIQUE(engagement_id, state).
- **audit_flags** — id, engagement_id→engagements, user_id, state, vda_window, has_prior_contact, notes, created_at, updated_at. UNIQUE(engagement_id, state).
- **comments** — id, engagement_id→engagements, user_id, state, parent_id, body, created_at.
- **snapshots** — id, engagement_id→engagements, user_id, share_token(UNIQUE), label, data(jsonb), created_at.
- **notifications** — id, user_id, workspace_id→workspaces, kind, title, body, is_read, created_at.
- **activity_log** — id, workspace_id→workspaces, user_id, action, target, meta(jsonb), created_at.
- **plans** — id(text PK, 'free'/'pro'), name, price_cents, created_at.
- **subscriptions** — id, user_id(UNIQUE), plan_id→plans (text), stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at.

---

## (b) Backend route files

All mount under `/api/v1` via `api.route('/<mount>', router)` in `src/index.ts`. Each file `export default router`. Auth column: "no" = public read, "yes" = requires `X-User-Id`, "admin" = `ADMIN_USER_IDS`.

### `workspaces.ts` — mount `workspaces`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET / | yes | list workspaces user belongs to | Workspace[] |
| POST / | yes | create workspace (creator becomes owner member) | Workspace |
| GET /:id | yes | workspace detail | Workspace |
| PUT /:id | yes | update workspace (owner) | Workspace |
| DELETE /:id | yes | delete workspace (owner) | {success} |
| GET /:id/members | yes | list members | Member[] |
| POST /:id/members | yes | add member (owner) | Member |
| DELETE /:id/members/:memberId | yes | remove member (owner) | {success} |

### `engagements.ts` — mount `engagements`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET / | yes | list engagements (optional ?workspace_id) | Engagement[] |
| POST / | yes | create engagement | Engagement |
| GET /:id | yes | engagement detail + totals | Engagement |
| PUT /:id | yes | update (name/desc/as_of_date/status) | Engagement |
| DELETE /:id | yes | delete | {success} |
| POST /:id/clone | yes | clone engagement + sales + assumptions | Engagement |
| POST /:id/lock | yes | lock/unlock engagement | Engagement |
| POST /:id/recompute | yes | recompute crossings+exposure+scenarios+totals | {ok, totals} |

### `assumptions.ts` — mount `assumptions`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET /:engagementId | yes | get assumptions (creates default if none) | Assumptions |
| PUT /:engagementId | yes | update assumptions, append change_log | Assumptions |
| GET /:engagementId/log | yes | assumption change log | LogEntry[] |

### `sales.ts` — mount `sales`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET /:engagementId | yes | list sales lines (paged, ?state) | SalesLine[] |
| POST /:engagementId | yes | add one sales line | SalesLine |
| POST /:engagementId/bulk | yes | add many sales lines (parsed rows) | {inserted} |
| DELETE /:engagementId | yes | delete all sales lines for engagement | {success} |
| DELETE /:engagementId/:lineId | yes | delete one sales line | {success} |
| GET /:engagementId/summary | yes | per-state sales totals | StateSummary[] |

### `imports.ts` — mount `imports`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET /:engagementId | yes | list import jobs | ImportJob[] |
| POST /:engagementId/csv | yes | create CSV import job, validate+insert rows | ImportJob |
| POST /:engagementId/connector | yes | create connector import job (Stripe/Shopify/etc) | ImportJob |
| POST /:engagementId/sample | yes | seed realistic sample multi-state sales | {job, inserted} |
| GET /:engagementId/:jobId/errors | yes | list import errors for a job | ImportError[] |

### `nexus-rules.ts` — mount `nexus-rules`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET / | no | list all state nexus rules | NexusRule[] |
| GET /:state | no | latest rule for a state | NexusRule |
| POST / | admin | create/version a rule | NexusRule |
| PUT /:id | admin | update a rule | NexusRule |

### `tax-rates.ts` — mount `tax-rates`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET / | no | list all state tax rates | TaxRate[] |
| GET /:state | no | latest rate for a state | TaxRate |
| POST / | admin | create/version a rate | TaxRate |
| PUT /:id | admin | update a rate | TaxRate |

### `taxability.ts` — mount `taxability`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET /:engagementId | yes | product-taxability matrix rows | Taxability[] |
| POST /:engagementId | yes | upsert taxability row | Taxability |
| DELETE /:engagementId/:id | yes | delete taxability row | {success} |

### `penalty-rules.ts` — mount `penalty-rules`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET / | no | list all penalty rules | PenaltyRule[] |
| GET /:state | no | latest penalty rule for a state | PenaltyRule |
| POST / | admin | create/version a penalty rule | PenaltyRule |
| PUT /:id | admin | update penalty rule | PenaltyRule |

### `interest-rates.ts` — mount `interest-rates`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET / | no | list all interest rates | InterestRate[] |
| GET /:state | no | interest rates for a state (by year) | InterestRate[] |
| POST / | admin | create interest rate | InterestRate |
| PUT /:id | admin | update interest rate | InterestRate |

### `vda-terms.ts` — mount `vda-terms`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET / | no | list all VDA terms | VdaTerm[] |
| GET /:state | no | VDA terms for a state | VdaTerm |
| POST / | admin | create/update VDA terms | VdaTerm |
| PUT /:id | admin | update VDA terms | VdaTerm |

### `crossings.ts` — mount `crossings`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET /:engagementId | yes | per-state crossing results | Crossing[] |
| GET /:engagementId/:state | yes | one state's crossing + timeline | Crossing |
| POST /:engagementId/detect | yes | run crossing detection, persist results | {ok, crossings} |

### `exposure.ts` — mount `exposure`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET /:engagementId | yes | per-state exposure rollups | StateExposure[] |
| GET /:engagementId/:state | yes | one state's period line items | {exposure, lines} |
| POST /:engagementId/compute | yes | compute tax+penalty+interest+VDA, persist | {ok, totals} |

### `scenarios.ts` — mount `scenarios`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET /:engagementId | yes | list computed scenarios | Scenario[] |
| POST /:engagementId/compute | yes | compute register/VDA/wait (?wait_months), mark recommended | Scenario[] |

### `materiality.ts` — mount `materiality`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET /:engagementId | yes | ranked states by exposure + bands (?threshold&?sort) | {ranking, rollup} |

### `memos.ts` — mount `memos`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET /:engagementId | yes | list memos for engagement | Memo[] |
| POST /:engagementId | yes | generate memo (scope consolidated|state) | Memo |
| GET /:engagementId/:memoId | yes | get one memo | Memo |
| DELETE /:engagementId/:memoId | yes | delete memo | {success} |

### `remediation.ts` — mount `remediation`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET /:engagementId | yes | remediation items (+progress rollup) | {items, progress} |
| POST /:engagementId | yes | upsert remediation item for a state | RemediationItem |
| PUT /:engagementId/:id | yes | update item (status/owner/checklist) | RemediationItem |

### `audit-flags.ts` — mount `audit-flags`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET /:engagementId | yes | audit-risk flags per state | AuditFlag[] |
| POST /:engagementId | yes | upsert audit flag (vda_window, prior contact) | AuditFlag |

### `wait-cost.ts` — mount `wait-cost`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET /:engagementId | yes | wait-cost timeline + VDA-erosion + deadline (?months) | {timeline, deadline} |

### `reports.ts` — mount `reports`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET /:engagementId/working-papers | yes | period-by-period export rows | WorkingPaperRow[] |
| GET /:engagementId/schedule | yes | consolidated per-state exposure schedule | ScheduleRow[] |
| GET /:engagementId/summary | yes | diligence-binder summary object | SummaryReport |

### `comments.ts` — mount `comments`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET /:engagementId | yes | comments (optional ?state) | Comment[] |
| POST /:engagementId | yes | add comment (optional parent_id/state) | Comment |
| DELETE /:engagementId/:id | yes | delete own comment | {success} |

### `snapshots.ts` — mount `snapshots`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET /:engagementId | yes | list snapshots for engagement | Snapshot[] |
| POST /:engagementId | yes | create locked shareable snapshot | Snapshot |
| GET /shared/:token | no | read-only snapshot by share token | Snapshot |
| DELETE /:engagementId/:id | yes | delete snapshot | {success} |

### `notifications.ts` — mount `notifications`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET / | yes | current user's notifications | Notification[] |
| POST /:id/read | yes | mark one read | Notification |
| POST /read-all | yes | mark all read | {success} |

### `activity.ts` — mount `activity`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET /:workspaceId | yes | workspace activity feed (paged) | Activity[] |

### `analytics.ts` — mount `analytics`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET /overview | yes | KPI tiles across engagements (?workspace_id) | {tiles} |
| GET /by-state | yes | exposure-by-state heat ranking (?engagement_id) | StateHeat[] |
| GET /trend/:engagementId | yes | exposure trend as data added | TrendPoint[] |

### `billing.ts` — mount `billing`
| METHOD path | auth | purpose | response |
|---|---|---|---|
| GET /plan | yes | current plan + stripeEnabled | {subscription, plan, stripeEnabled} |
| POST /checkout | yes | Stripe checkout (503 if unconfigured) | {url} \| 503 |
| POST /portal | yes | Stripe billing portal (503 if unconfigured) | {url} \| 503 |
| POST /webhook | no | Stripe webhook (503 if unconfigured) | {received} \| 503 |

Total route files: **27** (workspaces, engagements, assumptions, sales, imports, nexus-rules, tax-rates, taxability, penalty-rules, interest-rates, vda-terms, crossings, exposure, scenarios, materiality, memos, remediation, audit-flags, wait-cost, reports, comments, snapshots, notifications, activity, analytics, billing) plus `health` served inline in index.ts. (26 mounted domain files + billing = 26; nexus/tax/penalty/interest/vda = 5 library files.) Count of domain route files to author: 26.

---

## (c) `web/lib/api.ts` methods

`method name` — `HTTP` — `/api/proxy/<path>`. Path after `/api/proxy/` maps 1:1 to `/api/v1/`. Mutations send `Content-Type: application/json` + `JSON.stringify`.

Workspaces:
- `listWorkspaces` — GET — `/api/proxy/workspaces`
- `createWorkspace` — POST — `/api/proxy/workspaces`
- `getWorkspace` — GET — `/api/proxy/workspaces/:id`
- `updateWorkspace` — PUT — `/api/proxy/workspaces/:id`
- `deleteWorkspace` — DELETE — `/api/proxy/workspaces/:id`
- `listMembers` — GET — `/api/proxy/workspaces/:id/members`
- `addMember` — POST — `/api/proxy/workspaces/:id/members`
- `removeMember` — DELETE — `/api/proxy/workspaces/:id/members/:memberId`

Engagements:
- `listEngagements` — GET — `/api/proxy/engagements`
- `createEngagement` — POST — `/api/proxy/engagements`
- `getEngagement` — GET — `/api/proxy/engagements/:id`
- `updateEngagement` — PUT — `/api/proxy/engagements/:id`
- `deleteEngagement` — DELETE — `/api/proxy/engagements/:id`
- `cloneEngagement` — POST — `/api/proxy/engagements/:id/clone`
- `lockEngagement` — POST — `/api/proxy/engagements/:id/lock`
- `recomputeEngagement` — POST — `/api/proxy/engagements/:id/recompute`

Assumptions:
- `getAssumptions` — GET — `/api/proxy/assumptions/:engagementId`
- `updateAssumptions` — PUT — `/api/proxy/assumptions/:engagementId`
- `getAssumptionLog` — GET — `/api/proxy/assumptions/:engagementId/log`

Sales:
- `listSales` — GET — `/api/proxy/sales/:engagementId`
- `addSalesLine` — POST — `/api/proxy/sales/:engagementId`
- `bulkAddSales` — POST — `/api/proxy/sales/:engagementId/bulk`
- `deleteAllSales` — DELETE — `/api/proxy/sales/:engagementId`
- `deleteSalesLine` — DELETE — `/api/proxy/sales/:engagementId/:lineId`
- `getSalesSummary` — GET — `/api/proxy/sales/:engagementId/summary`

Imports:
- `listImports` — GET — `/api/proxy/imports/:engagementId`
- `importCsv` — POST — `/api/proxy/imports/:engagementId/csv`
- `importConnector` — POST — `/api/proxy/imports/:engagementId/connector`
- `seedSample` — POST — `/api/proxy/imports/:engagementId/sample`
- `getImportErrors` — GET — `/api/proxy/imports/:engagementId/:jobId/errors`

Reference libraries:
- `listNexusRules` — GET — `/api/proxy/nexus-rules`
- `getNexusRule` — GET — `/api/proxy/nexus-rules/:state`
- `createNexusRule` — POST — `/api/proxy/nexus-rules`
- `updateNexusRule` — PUT — `/api/proxy/nexus-rules/:id`
- `listTaxRates` — GET — `/api/proxy/tax-rates`
- `getTaxRate` — GET — `/api/proxy/tax-rates/:state`
- `createTaxRate` — POST — `/api/proxy/tax-rates`
- `updateTaxRate` — PUT — `/api/proxy/tax-rates/:id`
- `listPenaltyRules` — GET — `/api/proxy/penalty-rules`
- `getPenaltyRule` — GET — `/api/proxy/penalty-rules/:state`
- `createPenaltyRule` — POST — `/api/proxy/penalty-rules`
- `updatePenaltyRule` — PUT — `/api/proxy/penalty-rules/:id`
- `listInterestRates` — GET — `/api/proxy/interest-rates`
- `getInterestRates` — GET — `/api/proxy/interest-rates/:state`
- `createInterestRate` — POST — `/api/proxy/interest-rates`
- `updateInterestRate` — PUT — `/api/proxy/interest-rates/:id`
- `listVdaTerms` — GET — `/api/proxy/vda-terms`
- `getVdaTerm` — GET — `/api/proxy/vda-terms/:state`
- `createVdaTerm` — POST — `/api/proxy/vda-terms`
- `updateVdaTerm` — PUT — `/api/proxy/vda-terms/:id`

Taxability:
- `listTaxability` — GET — `/api/proxy/taxability/:engagementId`
- `upsertTaxability` — POST — `/api/proxy/taxability/:engagementId`
- `deleteTaxability` — DELETE — `/api/proxy/taxability/:engagementId/:id`

Crossings:
- `listCrossings` — GET — `/api/proxy/crossings/:engagementId`
- `getCrossing` — GET — `/api/proxy/crossings/:engagementId/:state`
- `detectCrossings` — POST — `/api/proxy/crossings/:engagementId/detect`

Exposure:
- `listExposure` — GET — `/api/proxy/exposure/:engagementId`
- `getStateExposure` — GET — `/api/proxy/exposure/:engagementId/:state`
- `computeExposure` — POST — `/api/proxy/exposure/:engagementId/compute`

Scenarios:
- `listScenarios` — GET — `/api/proxy/scenarios/:engagementId`
- `computeScenarios` — POST — `/api/proxy/scenarios/:engagementId/compute`

Materiality:
- `getMateriality` — GET — `/api/proxy/materiality/:engagementId`

Memos:
- `listMemos` — GET — `/api/proxy/memos/:engagementId`
- `generateMemo` — POST — `/api/proxy/memos/:engagementId`
- `getMemo` — GET — `/api/proxy/memos/:engagementId/:memoId`
- `deleteMemo` — DELETE — `/api/proxy/memos/:engagementId/:memoId`

Remediation:
- `getRemediation` — GET — `/api/proxy/remediation/:engagementId`
- `upsertRemediation` — POST — `/api/proxy/remediation/:engagementId`
- `updateRemediation` — PUT — `/api/proxy/remediation/:engagementId/:id`

Audit flags:
- `listAuditFlags` — GET — `/api/proxy/audit-flags/:engagementId`
- `upsertAuditFlag` — POST — `/api/proxy/audit-flags/:engagementId`

Wait cost:
- `getWaitCost` — GET — `/api/proxy/wait-cost/:engagementId`

Reports:
- `getWorkingPapers` — GET — `/api/proxy/reports/:engagementId/working-papers`
- `getSchedule` — GET — `/api/proxy/reports/:engagementId/schedule`
- `getSummaryReport` — GET — `/api/proxy/reports/:engagementId/summary`

Comments:
- `listComments` — GET — `/api/proxy/comments/:engagementId`
- `addComment` — POST — `/api/proxy/comments/:engagementId`
- `deleteComment` — DELETE — `/api/proxy/comments/:engagementId/:id`

Snapshots:
- `listSnapshots` — GET — `/api/proxy/snapshots/:engagementId`
- `createSnapshot` — POST — `/api/proxy/snapshots/:engagementId`
- `getSharedSnapshot` — GET — `/api/proxy/snapshots/shared/:token`
- `deleteSnapshot` — DELETE — `/api/proxy/snapshots/:engagementId/:id`

Notifications:
- `listNotifications` — GET — `/api/proxy/notifications`
- `markNotificationRead` — POST — `/api/proxy/notifications/:id/read`
- `markAllNotificationsRead` — POST — `/api/proxy/notifications/read-all`

Activity:
- `getActivity` — GET — `/api/proxy/activity/:workspaceId`

Analytics:
- `getAnalyticsOverview` — GET — `/api/proxy/analytics/overview`
- `getAnalyticsByState` — GET — `/api/proxy/analytics/by-state`
- `getAnalyticsTrend` — GET — `/api/proxy/analytics/trend/:engagementId`

Billing:
- `getBillingPlan` — GET — `/api/proxy/billing/plan`
- `startCheckout` — POST — `/api/proxy/billing/checkout`
- `openPortal` — POST — `/api/proxy/billing/portal`

Every method above is implemented by exactly one route endpoint in section (b) and consumed by at least one page in section (d). (`billing/webhook` is Stripe-only, not exposed via api.ts.)

---

## (d) Pages

Public (no sidebar chrome):

| URL | file (under web/) | kind | api methods | renders |
|---|---|---|---|---|
| `/` | `app/page.tsx` | public | (none) | Static landing: hero, problem, feature grid, CTAs. No auth calls. |
| `/auth/sign-in` | `app/auth/sign-in/page.tsx` | public | (authClient) | Client onSubmit sign-in form. |
| `/auth/sign-up` | `app/auth/sign-up/page.tsx` | public | (authClient) | Client onSubmit sign-up form. |
| `/pricing` | `app/pricing/page.tsx` | public | (none) | Static all-free pricing + Pro-soon note. |
| `/shared/[token]` | `app/shared/[token]/page.tsx` | public | getSharedSnapshot | Read-only shared engagement snapshot for diligence teams. |

Dashboard (wrapped by `app/dashboard/layout.tsx` → `DashboardLayout` sidebar):

| URL | file (under web/) | kind | api methods | renders |
|---|---|---|---|---|
| `/dashboard` | `app/dashboard/page.tsx` | dashboard | getAnalyticsOverview, listEngagements | KPI tiles (total tax/penalty/interest/VDA savings), recent engagements. |
| `/dashboard/workspaces` | `app/dashboard/workspaces/page.tsx` | dashboard | listWorkspaces, createWorkspace, updateWorkspace, deleteWorkspace, listMembers, addMember, removeMember | Workspaces list + members management. |
| `/dashboard/engagements` | `app/dashboard/engagements/page.tsx` | dashboard | listEngagements, createEngagement, cloneEngagement, deleteEngagement, listWorkspaces | Engagements list, create, clone. |
| `/dashboard/engagements/[id]` | `app/dashboard/engagements/[id]/page.tsx` | dashboard | getEngagement, recomputeEngagement, lockEngagement, updateEngagement | Engagement summary: totals, status, lock, recompute, sub-nav. |
| `/dashboard/engagements/[id]/sales` | `app/dashboard/engagements/[id]/sales/page.tsx` | dashboard | listSales, addSalesLine, deleteSalesLine, deleteAllSales, getSalesSummary | Sales lines table + add/delete + per-state summary. |
| `/dashboard/engagements/[id]/imports` | `app/dashboard/engagements/[id]/imports/page.tsx` | dashboard | listImports, importCsv, importConnector, seedSample, getImportErrors | Import jobs, CSV upload, connector, sample seeder, errors. |
| `/dashboard/engagements/[id]/crossings` | `app/dashboard/engagements/[id]/crossings/page.tsx` | dashboard | listCrossings, getCrossing, detectCrossings | Per-state crossing dates + running-measure timelines. |
| `/dashboard/engagements/[id]/exposure` | `app/dashboard/engagements/[id]/exposure/page.tsx` | dashboard | listExposure, getStateExposure, computeExposure | Per-state tax/penalty/interest + period line items. |
| `/dashboard/engagements/[id]/scenarios` | `app/dashboard/engagements/[id]/scenarios/page.tsx` | dashboard | listScenarios, computeScenarios | Register-now vs VDA vs Wait comparison + recommendation. |
| `/dashboard/engagements/[id]/materiality` | `app/dashboard/engagements/[id]/materiality/page.tsx` | dashboard | getMateriality | Ranked states, materiality bands, top-N rollup. |
| `/dashboard/engagements/[id]/wait-cost` | `app/dashboard/engagements/[id]/wait-cost/page.tsx` | dashboard | getWaitCost | Wait-cost timeline, VDA-savings erosion, decision deadline. |
| `/dashboard/engagements/[id]/taxability` | `app/dashboard/engagements/[id]/taxability/page.tsx` | dashboard | listTaxability, upsertTaxability, deleteTaxability, listTaxRates | Product-taxability matrix per state. |
| `/dashboard/engagements/[id]/assumptions` | `app/dashboard/engagements/[id]/assumptions/page.tsx` | dashboard | getAssumptions, updateAssumptions, getAssumptionLog | Assumptions register + change log. |
| `/dashboard/engagements/[id]/memo` | `app/dashboard/engagements/[id]/memo/page.tsx` | dashboard | listMemos, generateMemo, getMemo, deleteMemo | Exposure memo generator/viewer + report links. |
| `/dashboard/engagements/[id]/remediation` | `app/dashboard/engagements/[id]/remediation/page.tsx` | dashboard | getRemediation, upsertRemediation, updateRemediation, listAuditFlags, upsertAuditFlag | Remediation tracker + audit-risk flags. |
| `/dashboard/engagements/[id]/comments` | `app/dashboard/engagements/[id]/comments/page.tsx` | dashboard | listComments, addComment, deleteComment, createSnapshot | Threaded comments + create shareable snapshot. |
| `/dashboard/engagements/[id]/reports` | `app/dashboard/engagements/[id]/reports/page.tsx` | dashboard | getWorkingPapers, getSchedule, getSummaryReport | Working papers, consolidated schedule, binder summary exports. |
| `/dashboard/library/nexus-rules` | `app/dashboard/library/nexus-rules/page.tsx` | dashboard | listNexusRules, getNexusRule | State economic-nexus rules library. |
| `/dashboard/library/rates` | `app/dashboard/library/rates/page.tsx` | dashboard | listTaxRates, listPenaltyRules, listInterestRates, listVdaTerms | Tax / penalty / interest / VDA rates reference library. |
| `/dashboard/snapshots` | `app/dashboard/snapshots/page.tsx` | dashboard | listEngagements, listSnapshots, createSnapshot, deleteSnapshot | Locked shareable snapshots across engagements. |
| `/dashboard/notifications` | `app/dashboard/notifications/page.tsx` | dashboard | listNotifications, markNotificationRead, markAllNotificationsRead, listWorkspaces, getActivity | Notifications + workspace activity feed. |
| `/dashboard/analytics` | `app/dashboard/analytics/page.tsx` | dashboard | getAnalyticsOverview, getAnalyticsByState, getAnalyticsTrend, listEngagements | Analytics dashboards: heat ranking, trend, KPIs. |
| `/dashboard/settings` | `app/dashboard/settings/page.tsx` | dashboard | getBillingPlan, startCheckout, openPortal, listWorkspaces, updateWorkspace | Settings, workspace profile, billing/plan. |

Page counts: 5 public + 22 dashboard = **27 page.tsx routes**, plus route handlers `app/api/auth/[...path]/route.ts` and `app/api/proxy/[...path]/route.ts`.

---

## (e) DashboardLayout sidebar nav

`web/components/DashboardLayout.tsx` — `'use client'`, `<aside>` sidebar, active state via `usePathname()`, mobile drawer, sign-out via `authClient.signOut()`. Sections:

**Overview**
- Dashboard → `/dashboard`
- Analytics → `/dashboard/analytics`

**Engagements**
- All Engagements → `/dashboard/engagements`
- Workspaces → `/dashboard/workspaces`
- Snapshots → `/dashboard/snapshots`

**Reference Library**
- Nexus Rules → `/dashboard/library/nexus-rules`
- Rates & VDA → `/dashboard/library/rates`

**Account**
- Notifications → `/dashboard/notifications`
- Settings → `/dashboard/settings`

Per-engagement sub-nav (rendered inside `app/dashboard/engagements/[id]/page.tsx` and shared across its children as an in-page tab strip, since these routes are engagement-scoped): Summary, Sales, Imports, Crossings, Exposure, Scenarios, Materiality, Wait Cost, Taxability, Assumptions, Memo, Remediation, Comments, Reports — each linking to `/dashboard/engagements/[id]/<sub>`.
