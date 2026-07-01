# NexusExposureQuantifier

NexusExposureQuantifier turns the vague worry of "we probably should have registered for sales tax in some states" into a dated, defensible, state-by-state dollar figure: back-tax owed, late-registration penalties, and statutory interest, accrued from the exact month each state's economic-nexus threshold was first crossed to today. It then models the alternatives, register now and pay everything, enter a Voluntary Disclosure Agreement (VDA) that caps the lookback window and waives penalties, or wait and watch exposure grow, and produces a board-ready and auditor-ready exposure memo per state.

It is a deterministic backward-looking accrual engine, not a tax-filing service and not a forward-looking nexus monitor. The core competency is the precise accrual math: walking historical sales chronologically per state, finding the first month a rolling or calendar-year economic-nexus threshold was met, applying that state's combined tax rate to taxable sales from the crossing date forward, layering each state's specific late-registration penalty schedule and statutory interest accrual on top, and re-running that same math under a VDA's capped lookback to quantify the savings.

See [docs/idea.md](docs/idea.md) for the full product specification.

## Features

- Workspaces and engagements (multi-tenant exposure studies with an as-of date anchor)
- Sales data ingestion (CSV upload with column mapping, connector-style import jobs, one-click sample-data seeder, validation and dedup)
- State nexus rules library (per-state thresholds, measurement periods, effective-dated rule versions)
- State tax rate library (combined rates, effective-dated history, per-engagement rate overrides)
- Retroactive crossing-date detector (rolling-12-month vs calendar-year windows, dual amount and transaction-count tests)
- Per-state uncollected-tax estimator (period bucketing, taxable/exempt segregation)
- Penalty model (failure-to-file and failure-to-pay schedules, caps, minimums)
- Interest accrual model (per-state per-year statutory rate table, daily/monthly compounding)
- VDA lookback modeler (capped lookback, penalty waiver, side-by-side savings)
- Scenario comparison (register-now vs VDA vs wait)
- Materiality ranking (high/medium/low banding, top-N rollup)
- Exposure memo generator (board-ready and auditor-ready, per-state and consolidated)
- Assumptions and methodology register

All features are free for signed-in users.

## Stack

- **Backend:** Hono (TypeScript, ESM) on Node 22, run via `node --import tsx/esm`, Drizzle ORM over Neon Postgres (`@neondatabase/serverless`), zod validation.
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript strict, Tailwind CSS 4.
- **Auth:** Neon Auth (`@neondatabase/auth`). The Next.js server resolves the session and proxies requests to the backend with an `X-User-Id` header.
- **Database:** Neon Postgres.

## Local Development

Prerequisites: Node 22+, pnpm, and a Neon Postgres `DATABASE_URL`.

### Backend

```bash
cd backend
pnpm install
# create backend/.env (see below)
pnpm dev
```

The backend serves on port `3001` by default (`/api/v1/*`, plus `/health`).

### Frontend

```bash
cd web
pnpm install
# create web/.env.local (see below)
pnpm dev
```

The web app serves on port `3000`.

## Environment Variables

### `backend/.env`

```
PORT=3001
DATABASE_URL=postgres://user:password@host/db?sslmode=require
FRONTEND_URL=http://localhost:3000
ADMIN_USER_IDS=
```

### `web/.env.local`

```
NEON_AUTH_BASE_URL=https://<endpoint>.neonauth.<region>.aws.neon.tech/<db>/auth
NEON_AUTH_COOKIE_SECRET=<random 32-byte hex>
NEXT_PUBLIC_API_URL=http://localhost:3001
```

- `NEXT_PUBLIC_API_URL` is the only `NEXT_PUBLIC_*` variable, read by the proxy route to reach the backend. Browser code calls the backend through same-origin relative `/api/proxy/...` requests.
- `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` are server-only.

## Docker

```bash
docker compose up
```

Brings up the backend (port 3001) and the web app (port 3000) together. Set `DATABASE_URL` in `backend/.env` first.

## Deployment

- **Backend:** Render (see `render.yaml`). Set `DATABASE_URL` and `FRONTEND_URL` as Render env vars.
- **Frontend:** Vercel, with root directory `web` and Node 22.

The database schema is provisioned out-of-band (Drizzle push / Neon console); the app seeds reference data idempotently on boot but does not create its own tables.
