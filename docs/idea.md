# NexusExposureQuantifier

## Overview

NexusExposureQuantifier turns the vague, sleepless-night worry of "we probably should have registered for sales tax in some states" into a dated, defensible, state-by-state dollar figure: back-tax owed, late-registration penalties, and statutory interest, accrued from the exact month each state's economic-nexus threshold was first crossed to today. It then models the alternatives, register now and pay everything, enter a Voluntary Disclosure Agreement (VDA) that caps the lookback window and waives penalties, or do nothing and watch exposure grow, and produces a board-ready and auditor-ready exposure memo per state.

The product is a deterministic financial-analysis engine, not a tax-filing service and not a forward-looking nexus monitor. Its core competency is the precise accrual math: walking historical sales chronologically per state, finding the first month a rolling or calendar-year economic-nexus threshold was met, applying that state's combined tax rate to the taxable sales accrued from the crossing date forward, layering each state's specific late-registration penalty schedule and statutory interest accrual on top, and then re-running that same math under a VDA's capped lookback to quantify the savings.

The output is a single, citable number per state and a rolled-up total exposure, the exact deliverable a CFO needs for a diligence binder, an audit-committee deck, or a VDA filing. Everything is built for demoability: a one-click sample-data seeder generates realistic multi-state sales history so a prospect can see a fully populated exposure analysis within seconds of signing in.

## Problem

Unremediated sales-tax exposure is consistently a top finding in M&A and fundraising diligence. Since the 2018 *South Dakota v. Wayfair* decision, every state with a sales tax has an economic-nexus threshold (commonly $100,000 in sales or 200 transactions in a rolling twelve-month or calendar-year period). Software, SaaS, and e-commerce companies routinely blow past these thresholds in a dozen states without ever registering, collecting, or remitting, because they were focused on growth, not tax compliance.

The consequences land at the worst possible time:

- **Deal risk.** Acquirers' diligence teams demand a quantified, dated exposure number. An un-sized liability kills deals, forces large escrow holdbacks, or carves a dollar-for-dollar reduction out of the purchase price.
- **Time pressure.** Exposure grows every month as more periods accrue interest, and a VDA, the primary remediation tool, is foreclosed the moment a state opens an audit or sends a nexus questionnaire. The option to limit lookback and waive penalties has an expiration date that the company does not control.
- **Cost and opacity.** Sizing this is exactly what sellers pay sales-tax consultants four-to-five figures to do, often under deadline pressure, with the analysis delivered as an opaque spreadsheet the CFO cannot independently re-run when assumptions change.

CFOs and controllers need a defensible exposure number and a remediation plan they can produce in hours, re-run as facts firm up, and hand to a diligence team or a board without paying a consultant every time an input changes.

## Target Users

- **CFOs and VP Finance preparing for fundraising or M&A diligence.** They need a quantified, dated, defensible exposure figure and a remediation recommendation to put in the data room before the buyer's accountants size it for them.
- **Controllers and accounting managers** who just realized the company ignored nexus for years and need to understand the magnitude, prioritize which states matter, and present a remediation plan to leadership.
- **Fractional CFOs and outsourced finance teams** managing multiple portfolio companies who need to repeat this analysis per client.
- **Boutique sales-tax consultants and accounting firms** who want a faster, auditable engine to run client exposure studies instead of bespoke spreadsheets.

## Why this is NOT an existing project

Near-neighbors and the precise distinction:

- **Forward-looking nexus monitors (Avalara, TaxJar, Anrok, Numeral, Kintsugi nexus-tracking dashboards).** These watch your sales going forward and alert you when you are *about to* or *just* crossed a threshold so you can register and collect prospectively. They answer "where do I need to register now?" NexusExposureQuantifier answers the opposite, backward-looking question: "given that I already crossed thresholds years ago and never registered, how much do I owe in back-tax, penalties, and interest as of today, and what does a VDA save me?" Monitors do not model historical penalty/interest accrual or VDA lookback caps.
- **Sales-tax filing and remittance engines (Avalara Returns, TaxJar AutoFile).** These calculate and file *current-period* returns once you are registered. They do not quantify the historical liability for periods you never filed.
- **The tax-overcharge-reclaim keeper (a sibling venture).** That tool recovers sales/use tax *overpaid* on inbound vendor invoices, a refund-recovery use case. NexusExposureQuantifier is the inverse: it quantifies tax *underpaid/uncollected* on your own outbound sales, a liability-quantification use case.
- **General tax-compliance suites and GL/ERP tax modules.** These are transaction-tax calculators bolted to billing. None produce a VDA-vs-register-vs-wait scenario comparison with penalty-waiver savings math and a diligence-ready memo.
- **Spreadsheets from sales-tax consultants.** The status quo. Opaque, non-reproducible, expensive to re-run. NexusExposureQuantifier productizes the deterministic core (crossing detection, accrual, VDA cap math) so the CFO can re-run it instantly when assumptions change.

The defensible, distinct core is the **deterministic backward-looking accrual engine**: per-state crossing-date detection over historical sales, penalty-and-interest accrual encoded per state, and VDA lookback-cap math, producing a dated dollar figure no monitor or reclaim tool yields.

## Major Features

### 1. Workspaces and Engagements
Multi-tenant workspaces representing the company (or a client of a consultant). Each workspace owns engagements, an engagement is one exposure study with a name (e.g. "Series B Diligence 2026"), an as-of date that anchors all accrual math, a status (draft, in-review, final), and a set of assumptions. Sub-features: engagement cloning to model alternate scenarios, an as-of-date control that re-runs all accrual, engagement-level locking to freeze a final number for the data room, and an engagement summary dashboard.

### 2. Sales Data Ingestion
Bring historical sales into an engagement. Sub-features: CSV upload with column mapping (date, state, jurisdiction, amount, taxable flag, transaction id, product/category, exempt reason), connector-style imports (Stripe, Shopify, QuickBooks, NetSuite, generic JSON, modeled as import jobs that normalize to the canonical sales line shape), a built-in sample-data seeder that synthesizes realistic multi-state sales history for instant demoability, per-row validation with an errors queue, deduplication, and import-job audit trail.

### 3. State Nexus Rules Library
A maintained reference library of each US state's economic-nexus rules. Sub-features: per-state sales threshold and transaction-count threshold, measurement period (rolling 12-month vs previous/current calendar year), whether marketplace-facilitated sales count, inclusion of exempt/wholesale sales in the measure, effective date of the state's economic-nexus law (post-Wayfair), notes and statutory citations, and effective-dated rule versions so historical analysis uses the rule in force at the time.

### 4. State Tax Rate Library
Per-state combined tax rate references used to estimate uncollected tax. Sub-features: state base rate, average combined (state + local) rate, effective-dated rate history, product-category/taxability rate overrides (e.g. SaaS taxable in some states only), and a per-engagement override allowing the analyst to substitute a measured effective rate computed from the company's own sales mix.

### 5. Retroactive Crossing-Date Detector
The first pillar. Walks an engagement's historical sales chronologically per state and finds the exact period the state's threshold was first met, honoring the state's measurement window. Sub-features: rolling-12-month vs calendar-year window logic, dual sales-amount and transaction-count tests (crossing on whichever trips first), marketplace-sales inclusion toggle, a per-state crossing timeline showing the running measure vs threshold month by month, and a recompute trigger when sales or rules change.

### 6. Per-State Uncollected-Tax Estimator
The second pillar. From each state's crossing date forward to the engagement as-of date, applies the state's effective tax rate to taxable sales to estimate uncollected tax owed, period by period. Sub-features: monthly/quarterly period bucketing matching the state's filing frequency, taxable-vs-exempt sales segregation, effective-rate selection (library vs engagement override), per-period uncollected-tax line items, and a per-state subtotal of base tax owed.

### 7. Penalty Model
The third pillar (part A). Encodes each state's late-registration / failure-to-file / failure-to-pay penalty schedule and applies it to the accrued base tax. Sub-features: failure-to-file and failure-to-pay penalty rates, penalty caps and minimums, monthly penalty accrual where applicable, per-state penalty configuration with effective-dating, and a per-period penalty line item.

### 8. Interest Accrual Model
The third pillar (part B). Encodes each state's statutory interest rate (often adjusted annually) and accrues interest on unpaid tax from each period's due date to the as-of date. Sub-features: per-state per-year statutory interest rate table, daily vs monthly compounding configuration, interest computed per filing period from its statutory due date, and a per-state interest subtotal.

### 9. VDA Lookback Modeler
The fourth pillar. Re-runs the entire exposure under a Voluntary Disclosure Agreement: caps the lookback to the state's VDA lookback period (commonly 3-4 years), typically waives penalties, and often abates some interest, then quantifies the savings versus doing nothing. Sub-features: per-state VDA lookback-period library, penalty-waiver and interest-treatment flags per state, VDA-eligibility checks (is an audit pending?), side-by-side "full exposure vs VDA exposure" per state, and a total VDA savings figure.

### 10. Scenario Comparison (Register-Now vs VDA vs Wait)
Compares the three remediation paths on a single screen. Sub-features: "register now and pay full back-tax + penalty + interest", "VDA" (capped lookback, waived penalties), and "wait N months" (exposure projected forward with continued accrual), each with a total dollar figure, a per-state breakdown, and a recommended path based on materiality and savings.

### 11. Materiality Ranking
Ranks states by exposure so the CFO knows where to focus. Sub-features: configurable materiality threshold (absolute dollar or percent of total), automatic high/medium/low banding, sort by total exposure, by tax-only, or by VDA savings, and a "top N states drive X% of exposure" rollup.

### 12. Exposure Memo Generator
Produces a board-ready / auditor-ready exposure memo per state and a consolidated memo. Sub-features: structured memo sections (background, methodology, assumptions, per-state exposure, recommendation), templated narrative populated from the computed numbers, citations to the rules/rates used, an as-of-date stamp, and export to a printable/shareable document.

### 13. Assumptions and Methodology Register
Every exposure number is only as defensible as its assumptions. Sub-features: a per-engagement assumptions record (effective-rate basis, taxability stance on the company's products, marketplace treatment, compounding convention), a methodology note attached to every computed figure, and an assumptions-change log so reviewers see what changed and when.

### 14. Wait-Cost Timeline
Quantifies the cost of delay: how much exposure grows each month the company waits, and the date a VDA stops being worthwhile or an audit risk window opens. Sub-features: projected monthly exposure growth per state, a "VDA savings erosion" curve, and a recommended decision deadline.

### 15. Product Taxability Matrix
Models whether the company's products/services are taxable per state (critical for SaaS). Sub-features: per-product-category taxability per state, default taxability inheritance from the rate library, per-engagement overrides, and re-computation of taxable sales when taxability stance changes.

### 16. Registration and Remediation Tracker
Tracks the operational follow-through after the number is sized. Sub-features: per-state remediation status (not started, VDA submitted, registered, remitted, closed), assigned owner, target dates, document checklist, and a remediation progress rollup.

### 17. Audit-Risk Indicator
Flags states where the option to VDA is most at risk. Sub-features: per-state audit-activity notes, a "VDA window open/closing/closed" flag per state, and surfacing of any state where a pending audit or questionnaire has been recorded (which forecloses VDA).

### 18. Reports and Exports
Beyond the memo, structured exports for the data room and the consultant's working papers. Sub-features: per-state working-paper export (period-by-period tax/penalty/interest), consolidated exposure schedule (CSV/JSON), a diligence-binder summary, and a snapshot export tied to an engagement lock.

### 19. Notifications and Activity Feed
Keeps the engagement team informed. Sub-features: import-completed and recompute-completed notifications, assumption-change and engagement-lock notifications, an audit-window-closing alert, and a per-workspace activity feed.

### 20. Collaboration and Sharing
Multiple people work an engagement. Sub-features: per-engagement collaborators (read/comment), shareable read-only engagement snapshots for the buyer's diligence team, threaded comments on a state's exposure, and an exportable shareable memo link.

### 21. Dashboards and Analytics
A workspace-level and engagement-level analytics view. Sub-features: total exposure across engagements, exposure-by-state heat ranking, VDA-savings-captured tracking, trend of exposure as data is added, and KPI tiles (total tax, total penalty, total interest, total VDA savings).

### 22. Settings, Workspace, and Billing
Account-level configuration. Sub-features: workspace profile and members, per-user preferences, default engagement assumptions, billing/plan view (all features free for signed-in users; Stripe optional and returns 503 when unconfigured), and API-style data exports.

## Data Model (tables)

- **workspaces** — tenant/company container.
- **workspace_members** — user membership and role within a workspace.
- **engagements** — one exposure study; as-of date, status, assumptions.
- **assumptions** — per-engagement assumption set + change log entries.
- **sales_lines** — normalized historical sales transactions.
- **import_jobs** — ingestion job records (CSV/connector/sample) with status.
- **import_errors** — per-row validation errors for an import job.
- **state_nexus_rules** — per-state economic-nexus thresholds and windows (effective-dated).
- **state_tax_rates** — per-state combined rates (effective-dated).
- **product_taxability** — per-engagement product-category taxability per state.
- **state_penalty_rules** — per-state penalty schedules (effective-dated).
- **state_interest_rates** — per-state statutory interest rates by year.
- **state_vda_terms** — per-state VDA lookback period and waiver flags.
- **crossing_results** — computed per-state crossing date + tripping test.
- **exposure_lines** — per-state per-period tax/penalty/interest line items.
- **state_exposures** — per-state rolled-up exposure (tax, penalty, interest, totals).
- **scenarios** — register-now/VDA/wait scenario definitions and results.
- **memos** — generated exposure memos per engagement (+ per-state sections).
- **remediation_items** — per-state remediation tracking.
- **audit_flags** — per-state audit-activity / VDA-window flags.
- **comments** — threaded comments on engagements/states.
- **snapshots** — locked/shareable engagement snapshots.
- **notifications** — per-user notifications.
- **activity_log** — per-workspace activity feed.
- **plans** — billing plans (free/pro).
- **subscriptions** — per-user subscription state.

## API Surface (high level)

- `/workspaces` — workspace CRUD + members.
- `/engagements` — engagement CRUD, clone, lock, recompute trigger.
- `/assumptions` — get/update engagement assumptions + change log.
- `/sales` — sales-line list/upload/delete; per-engagement.
- `/imports` — import jobs (CSV/connector/sample seeder), errors.
- `/nexus-rules` — state nexus rules library (public read).
- `/tax-rates` — state tax rate library (public read).
- `/taxability` — per-engagement product taxability matrix.
- `/penalty-rules` — state penalty rules library (public read).
- `/interest-rates` — state interest rates library (public read).
- `/vda-terms` — state VDA terms library (public read).
- `/crossings` — crossing-date detection results + recompute.
- `/exposure` — per-state exposure + period line items.
- `/scenarios` — scenario comparison compute + list.
- `/materiality` — materiality ranking for an engagement.
- `/memos` — memo generation, get, list.
- `/remediation` — remediation tracker items.
- `/audit-flags` — audit-risk flags.
- `/wait-cost` — wait-cost timeline projection.
- `/reports` — exports (working papers, consolidated schedule, summary).
- `/comments` — engagement/state comments.
- `/snapshots` — locked shareable snapshots.
- `/notifications` — per-user notifications.
- `/activity` — workspace activity feed.
- `/analytics` — workspace/engagement dashboards.
- `/billing` — plan view (Stripe optional 503).

## Frontend Pages (~24)

Public:
1. `/` — static landing page.
2. `/auth/sign-in` — sign in.
3. `/auth/sign-up` — sign up.
4. `/pricing` — pricing (all-free messaging).

Dashboard (sidebar chrome):
5. `/dashboard` — overview: total exposure, KPI tiles, recent engagements.
6. `/dashboard/workspaces` — workspaces + members.
7. `/dashboard/engagements` — engagements list + create/clone.
8. `/dashboard/engagements/[id]` — engagement detail / summary.
9. `/dashboard/engagements/[id]/sales` — sales data + upload.
10. `/dashboard/engagements/[id]/imports` — import jobs + sample seeder + errors.
11. `/dashboard/engagements/[id]/crossings` — crossing-date detector timelines.
12. `/dashboard/engagements/[id]/exposure` — per-state exposure breakdown.
13. `/dashboard/engagements/[id]/scenarios` — register/VDA/wait comparison.
14. `/dashboard/engagements/[id]/materiality` — materiality ranking.
15. `/dashboard/engagements/[id]/wait-cost` — wait-cost timeline.
16. `/dashboard/engagements/[id]/taxability` — product taxability matrix.
17. `/dashboard/engagements/[id]/assumptions` — assumptions register + change log.
18. `/dashboard/engagements/[id]/memo` — exposure memo generator/view.
19. `/dashboard/engagements/[id]/remediation` — remediation tracker.
20. `/dashboard/engagements/[id]/comments` — collaboration/comments.
21. `/dashboard/library/nexus-rules` — state nexus rules library.
22. `/dashboard/library/rates` — tax/penalty/interest/VDA rates library.
23. `/dashboard/snapshots` — locked shareable snapshots.
24. `/dashboard/notifications` — notifications + activity feed.
25. `/dashboard/analytics` — analytics dashboards.
26. `/dashboard/settings` — settings, workspace, billing.
