# BCIS Deployment Guide

Target layout for the lab/office: **one server PC** (PostgreSQL + API) and **three client PCs** (Electron desktop only).

## 1. Server PC

### Software

1. Install PostgreSQL 16+ and ensure `pg_dump` / `pg_restore` are on PATH (or set `PG_BIN_DIR` in `.env`).
2. Create database and role; set `DATABASE_URL` in `.env` (see `.env.example`).
3. Install Node.js 22+ and pnpm 10+.
4. Clone/copy the repo; run:

```bash
pnpm install
cp .env.example .env
# Set DATABASE_URL, JWT_SECRET, SEED_OWNER_PASSWORD
# API_HOST=0.0.0.0  API_PORT=3001
pnpm db:setup
pnpm build
```

Optional lab data: `pnpm db:seed:demo` (never in production).

### Run API on startup (Windows)

Example: Task Scheduler or a service wrapper that starts:

```bash
pnpm --filter @bcis/api start
```

(or `node` against the built API entry used by the package). Keep working directory at the repo root so `.env`, `ATTACHMENTS_DIR`, and `BACKUPS_DIR` resolve correctly.

Suggested env on the server:

| Variable | Value |
|----------|--------|
| `API_HOST` | `0.0.0.0` (listen on LAN) |
| `API_PORT` | `3001` |
| `ATTACHMENTS_DIR` | e.g. `D:\BCIS\storage\attachments` |
| `BACKUPS_DIR` | e.g. `D:\BCIS\storage\backups` |
| `CORS_ORIGINS` | Include packaged Electron origins (`file://`, `null`) and any Vite dev hosts if used |

### Static IP and firewall

1. Assign the server a **static LAN IP** (e.g. `192.168.1.10`).
2. Allow inbound **TCP 3001** from the office LAN only (Windows Firewall inbound rule).
3. Do not expose 3001 to the public internet without additional hardening (TLS reverse proxy, VPN, etc.). This lab design assumes a private office network.

Health check from another PC: `http://<server-ip>:3001/health`.

## 2. Client PCs (×3)

1. Build the Windows installer on a build machine: `pnpm build:installer`.
   Output: `apps/desktop/dist/BCIS-Subscription-Billing-Setup-0.1.0.exe`.
2. Install that NSIS package on each client PC.
3. Point each client at the server API via editable **`bcis-config.json`** (preferred) or env:

```json
{ "apiBaseUrl": "http://192.168.1.10:3001" }
```

Resolution order in `apps/desktop/src/main/index.ts`:

1. `bcis-config.json` beside the installed `.exe` (if writable)
2. `%APPDATA%/bcis-subscription-billing/bcis-config.json` (created on first run)
3. Packaged `resources/bcis-config.json`
4. Environment variable `BCIS_API_BASE_URL`
5. Default `http://127.0.0.1:3001`

IPC contract remains `window.bcis.getConfig().apiBaseUrl`.

4. Clients do **not** need PostgreSQL or Node for production use of a packaged app.
5. Use unique staff usernames; do not share the owner password.

## 3. Backup schedule

1. Prefer daily automated backup via API (`POST /backups` with a service account that has `backup.create`) or a scheduled task calling the same service path the UI uses.
2. After each backup, run **Verify** (`POST /backups/:id/verify`) — SHA-256 of `database.dump` must match `manifest.json`, and `pg_restore --list` must succeed.
3. Copy verified backup folders off-box (USB / NAS) weekly. Keep several generations.
4. Confirm `BACKUPS_DIR` and `ATTACHMENTS_DIR` are on reliable disk with enough space.

`backup_history` records create/verify/restore actions (insert-only).

## 4. Restore steps

1. Confirm the chosen backup folder is **verified** (`manifest.verified === true`).
2. Notify users — restore locks writes (API returns 503 `WRITE_LOCKED` on mutations).
3. From **Administration → Backups** (or API): restore with confirmation body typing **`RESTORE`** (`backup.restore` permission).
4. The service creates a **pre-restore safety backup**, then `pg_restore`s the dump and restores attachments per `backup-service.ts`.
5. Restart/reconnect clients; spot-check a known subscriber balance and a recent receipt.
6. If restore fails, recover from the safety backup folder under `BACKUPS_DIR`.

## 5. Smoke checklist after deploy

- [ ] `/health` OK from a client PC  
- [ ] Login as Owner and Cashier  
- [ ] Open subscriber list and receive a small cash payment in a test DB  
- [ ] Create + verify a backup  
- [ ] Confirm firewall blocks non-LAN access to 3001  
