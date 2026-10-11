# BCIS Subscription Billing & Collection System

Solo lab project: Electron desktop clients → Fastify API → PostgreSQL (Drizzle). Financial posting is transactional; money is integer **centavos** end-to-end.

## Prerequisites

- Node.js 22+ and [pnpm](https://pnpm.io/) 10+
- PostgreSQL 16+ (local or on the office server PC)
- `pg_dump` / `pg_restore` on PATH (or set `PG_BIN_DIR`) for backup/restore

## Setup

```bash
pnpm install
cp .env.example .env
# Edit .env: DATABASE_URL, JWT_SECRET, SEED_OWNER_PASSWORD, APP_ENV=development
pnpm db:setup
```

`db:setup` runs migrations then the idempotent lab seed (roles, catalog, users, subscribers, billing).

### Reset / re-seed (lab only)

```bash
pnpm db:reset   # drop + create DB, migrate, seed
pnpm db:seed    # truncate domain tables and re-seed (idempotent)
```

Both require `APP_ENV=development` or `APP_ENV=test` and print the target database name first.
Subscriber names and financial rows are fictional lab data only.

## Run

```bash
pnpm dev:api        # http://127.0.0.1:3001
pnpm dev:desktop    # Electron; expects API on 3001
pnpm dev            # both in parallel
```

Override the desktop API URL with `BCIS_API_BASE_URL` (default `http://127.0.0.1:3001`).

### Dev logins (lab only — never for production)

| Username | Password | Role |
|----------|----------|------|
| `SEED_OWNER_USERNAME` (default `owner`) | `SEED_OWNER_PASSWORD` | Owner |
| admin | AdminPass123! | Administrator |
| cashier | CashierPass123! | Cashier |
| supervisor | SupervisorPass123! | Collection Supervisor |
| auditor | AuditorPass123! | Auditor |
| collector1 / collector2 | CollectorPass123! | Collector |

## Test

```bash
pnpm typecheck
pnpm lint
pnpm test                 # unit/integration across packages
pnpm test:acceptance      # AT domain tests (payments, billing, batches, backup)
pnpm test:concurrency     # AT-09 parallel payment/ledger harness
```

Acceptance tests that need `pg_dump` skip with a warning when the binary is missing.

## Build

```bash
pnpm build
pnpm build:installer   # Windows NSIS → apps/desktop/dist/BCIS-Subscription-Billing-Setup-*.exe
```

Builds `packages/*` then `apps/*` (API + Electron). The installer reads the API URL from editable `bcis-config.json` (see `docs/deployment-guide.md`).

## Workspace layout

| Path | Purpose |
|------|---------|
| `apps/api` | Fastify + Pino HTTP API, domain services, lab seed |
| `apps/desktop` | Electron main/preload + React renderer |
| `packages/shared` | Zod schemas, permissions, money/allocation/billing pure logic |
| `packages/db` | Drizzle schema, migrations, db reset |
| `docs/` | SPEC, ADRs, manuals, technical notes |

## Docs

| Doc | Contents |
|-----|----------|
| [docs/SPEC.md](docs/SPEC.md) | Product requirements |
| [docs/technical-documentation.md](docs/technical-documentation.md) | Architecture, ERD, API, security |
| [docs/user-manual.md](docs/user-manual.md) | Operator how-to |
| [docs/deployment-guide.md](docs/deployment-guide.md) | One-server + three-client deploy |
| [docs/decisions.md](docs/decisions.md) | Architecture decision records |
| [docs/defense-notes.md](docs/defense-notes.md) | Answers to SPEC defense questions |

## Notes

- Renderer never talks to PostgreSQL; all data goes through the API.
- Posted payments/invoices are reversed/voided, never hard-deleted.
- Prefer `127.0.0.1` over `localhost` for the API base URL (CORS + Electron).
