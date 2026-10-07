# BCIS Subscription Billing & Collection System

Solo lab project: desktop Electron client + Fastify API + PostgreSQL (Drizzle).

## Prerequisites

- Node.js 22+ and [pnpm](https://pnpm.io/) 10+
- PostgreSQL 16+ running locally

## Setup

```bash
pnpm install
cp .env.example .env
# Edit .env: DATABASE_URL, JWT_SECRET, SEED_OWNER_PASSWORD
pnpm db:setup
```

`db:setup` runs migrations then seeds roles, permissions, settings, and the owner user.

## Run

```bash
# API only (http://127.0.0.1:3001)
pnpm dev:api

# Desktop (Electron) — expects API on port 3001
pnpm dev:desktop

# Both
pnpm dev
```

Override the API URL for the desktop app with `BCIS_API_BASE_URL`.

Default seeded owner (from `.env`):

- Username: `SEED_OWNER_USERNAME` (default `owner`)
- Password: `SEED_OWNER_PASSWORD`

## Quality checks

```bash
pnpm typecheck
pnpm lint
pnpm test
```

## Workspace layout

| Path | Purpose |
|------|---------|
| `apps/api` | Fastify + Pino HTTP API |
| `apps/desktop` | Electron + React UI |
| `packages/shared` | Zod schemas, permissions, money utils |
| `packages/db` | Drizzle schema, migrations, seeds |

## Notes

- Money is integer **centavos** (`bigint`) end-to-end; format only in the UI.
- Renderer never talks to PostgreSQL; all data goes through the API.
- Billing and payments modules are intentionally not implemented yet.
