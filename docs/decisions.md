# Decisions

## 2026-10-07 — Foundation stack and auth

- Monorepo: `apps/api`, `apps/desktop`, `packages/shared`, `packages/db` per project rules.
- Auth: JWT bearer tokens with `session_version` on `users`; logout increments version (revokes outstanding tokens).
- Lockout: failed attempt counter + `locked_until`; defaults 5 attempts / 15 minutes (overridable via env).
- `audit_logs`: insert-only enforced by DB triggers blocking UPDATE/DELETE.
- Desktop: `contextIsolation=true`, `nodeIntegration=false`; preload exposes config + lock/logout helpers only.
- Role matrix aligned to SPEC 3.1 minimums: Administrator is operational (no user/role/settings/audit/backup); Cashier includes `gcash.verify`; Technician is service-scoped only. Seed replaces `role_permissions` per role so removals apply on re-seed.
- Sidebar follows SPEC 4.3b nested sections; placeholder child routes until domain screens land.
