# Defense notes

Short answers to the ten design questions at the end of [SPEC.md](./SPEC.md), pointing at real code.

## 1. Why PostgreSQL over shared SQLite?

Three concurrent office clients need a real server with row locks, transactions, and unique constraints under contention. A shared SQLite file over the network invites corruption and lock storms. This project uses PostgreSQL via Drizzle (`packages/db`, `apps/api/src/plugins/db.ts`); Electron never opens the database.

## 2. Where does billing / payment logic live?

| Concern | Location |
|---------|----------|
| Pure allocation / invoice math | `packages/shared/src/billing/` (`allocation.ts`, invoice helpers) |
| Billing generate / credit apply | `apps/api/src/services/billing-service.ts` (`generateBillingForPeriod`) |
| Payment post / GCash / reverse | `apps/api/src/services/payment-service.ts` (`postPayment`, `recordGCashPending`, `verifyGCashPayment`, `reversePayment`) |
| HTTP surface | `apps/api/src/routes/billing.ts`, `payments.ts` |

React only calls the API; it does not compute authoritative balances.

## 3. How are duplicate invoices / receipts / GCash refs prevented?

| Artifact | Mechanism |
|----------|-----------|
| Invoice per account+period | Partial unique index `invoices_service_account_period_active_idx` (status ≠ VOID) in `packages/db/src/schema/billing.ts`; generator skips existing in `generateBillingForPeriod` |
| Invoice / receipt numbers | Locked `account_sequences` via `nextAccountNumber` in `apps/api/src/lib/account-number.ts` (`INV-`, `RCPT-`) |
| GCash reference | Partial unique index `payments_gcash_ref_active_idx` on PENDING/VERIFIED GCash refs (`packages/db/src/schema/payments.ts`); conflicts → 409 in `payment-service.ts` |
| Payment replay | Unique `payments.idempotency_key` |

## 4. How is a partial payment stored?

`postPaymentInTransaction` allocates via `allocateOldestFirst`, inserts `payment_allocations` rows for each invoice amount, updates invoice `paid_centavos` / `balance_centavos` / status (`PARTIALLY_PAID` when balance remains), and writes one ledger CREDIT for the full payment amount. See `apps/api/src/services/payment-service.ts` and AT-02 in acceptance tests.

## 5. Why are payments reversed, not deleted?

Deleting would erase audit history and break ledger chronology. `reversePayment` inserts `payment_reversals`, posts a `PAYMENT_REVERSAL` ledger debit, restores invoice balances, sets payment status `REVERSED`, and voids the receipt while **keeping** the receipt number. Required reason + `writeAuditLog`. Spec rule: posted financial records are reversed/adjusted, never silently deleted.

## 6. How is ledger correctness proven?

- Pure running-balance helper tested in `packages/shared` Vitest suites.
- Domain acceptance tests: `pnpm test:acceptance` (payments, billing, batches, backup).
- Invariant documented in decisions: ledger net ≡ open balances − unapplied credit (advance credited once at payment; billing consumes `subscriber_credits` without a second ledger credit).
- Concurrent stress: `pnpm test:concurrency` (`apps/api/src/scripts/concurrency.ts`).

## 7. What if the API crashes mid-posting?

Posting runs inside `db.transaction(...)` (`postPaymentInTransaction`, `generateBillingForPeriod`, etc.). A crash before commit rolls back; no half-written payment/allocations/ledger/receipt. Idempotency keys allow safe client retry. During restore, `acquireWriteLock` blocks other mutations (`apps/api/src/lib/write-lock.ts`).

## 8. Server authorization vs hidden buttons?

UI hides actions by permission, but every sensitive route uses `app.requirePermission(...)` in `apps/api/src/routes/*` (plugin: `apps/api/src/plugins/auth.ts`). Direct API calls without the permission get 403 (AT-10). Buttons are UX only.

## 9. How are backups validated and restored?

`apps/api/src/services/backup-service.ts`:

- **Create:** `pg_dump -Fc`, copy attachments, SHA-256 + `manifest.json`, row in `backup_history`.
- **Verify:** re-hash dump vs manifest + `pg_restore --list`; sets `manifest.verified`.
- **Restore:** requires verified backup, typed `RESTORE` (`restoreBackupSchema`), pre-restore safety backup, write lock, then restore dump/attachments.

Routes: `apps/api/src/routes/backups.ts`.

## 10. Changes for a future collector mobile / PWA?

Keep the Fastify API as the system of record. Add a web client that uses the same JWT + RBAC endpoints (especially collection batches, route sheet, payment create). Needs: HTTPS + hardened CORS origins, refresh/token storage suitable for browsers, tighter mobile auth (short TTL / device binding), and possibly offline queue with idempotency keys. No SQLite on the phone as source of truth; do not bypass `requirePermission`. Electron preload stays desktop-only — mobile would be ordinary HTTPS `fetch` to the API.
