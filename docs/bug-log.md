# Bug log

## 2026-10-07

| Issue | Root cause | Fix | Regression test |
|-------|------------|-----|-----------------|
| CORS blocking PUT/PATCH/DELETE | `@fastify/cors` v11 defaults methods to GET/HEAD/POST only | Explicit methods list + `CORS_ORIGINS`; OPTIONS on `onRequest` before auth | `tests/cors.test.ts` |
| Dropdowns exceeding pageSize cap | List endpoints reject `pageSize` > 100; UI requested more | Dedicated `/options` routes (max 50) + `AsyncCombobox`; cap list queries at 100 | options/list tests in subscribers |
| Area description validation | Empty string failed Zod / NOT NULL mismatch | `optionalNullableText` `""`→null; store `""` in NOT NULL columns | area create/edit tests |
| Post-save refetch error shown as save failure | Dialog closed then refetch threw; surfaced as save error | Invalidate queries after success; toast on success; map `issues` inline | area/plan/subscriber edit flows |
| Empty ledger / missing service accounts | Invoices/payments created without ACTIVE service accounts billed | Ensure SA creation before billing; demo seed uses real services | `demo-integrity.test.ts`, billing tests |
| Edits not saving (silent) | Same CORS methods gap — preflight failed | CORS methods fix | `tests/cors.test.ts` |
| Users with no Collector role | Collectors assigned as users without Collector permissions; options empty | Dedicated `Collector` role in matrix + seed sync | permissions tests + collectors options |
| Advance payment double-counted in ledger | Payment credited full amount AND billing posted `CREDIT_APPLICATION` | Billing applies credit without second ledger credit | `demo-integrity.test.ts`, AT-03 |
| Report PDF generation failed | pdfmake 0.3 needs `setFonts(Roboto)` + font access policy | Export helper sets fonts; tests check PDF magic | export tests in `reports.test.ts` |
| GCash duplicate ref returned 500 | Unique violation wrapped; cause chain not walked | `isUniqueViolation` walks error cause → 409 | AT-05 |
| Role matrix drift vs SPEC 3.1 | Administrator had near-Owner rights; Cashier lacked `gcash.verify` | Matrix + seed replace sync | `packages/shared` permissions tests |
| Missing SPEC at foundation | Implemented from rules only | Aligned to `docs/SPEC.md` | acceptance suite AT-01..12 |

## 2026-10-09

| Issue | Root cause | Fix | Regression test |
|-------|------------|-----|-----------------|
| Dashboard used tables instead of SPEC §4.3 charts | Charts deferred; no shared trailing windows | Recharts dashboard cards + `collectionsTrend` / `actionRequired` / `expectedCentavos`; brief server cache; same query helpers as reports | `dashboard chart totals equal corresponding report totals` in `reports.test.ts` |
| Receivables Outstanding/Overdue/Suspension Candidates were placeholders | Lists and suspension-candidate endpoint not wired | Shared open-invoice aging set powers outstanding/overdue; candidates honor `suspension_threshold_centavos`; UI + export + service_events | `tests/receivables.test.ts` |
| Cached user could appear after session restore | Renderer trusted sessionStorage profile without checking the token | Refresh profile through authenticated `/auth/me`; clear invalid sessions | `tests/auth.test.ts` |
| Subscriber mobile numbers had inconsistent storage/display | Phone was unrestricted text | Shared Zod normalization to `+639XXXXXXXXX`; formatted UI display | `schemas/subscribers.test.ts` |
| Batch collection created duplicate route rows | Recording always inserted a new batch account instead of updating its route entry | Update the existing subscriber row and apply only the collection delta to batch totals | `collection-batches.test.ts` |
| Collection placeholders hid implemented workflows | Desktop client had no batch/remittance/collector API bindings or screens | Connected batch lifecycle, reconciliation, assignments, route printing, and subscriber history | collection API acceptance tests |
| Demo integrity test included unrelated test subscribers | Realistic names removed the old `Demo Subscriber%` selector | Deterministically tag fictional demo records in notes and scope invariants to that tag | `demo-integrity.test.ts` |
| Settings / Roles / Audit / subscriber Documents tabs were placeholders | Admin and profile screens deferred | Typed settings API + UI, roles matrix, audit DataTable, documents/audit tabs; live settings cache for overdue/auth | `tests/settings.test.ts` |
