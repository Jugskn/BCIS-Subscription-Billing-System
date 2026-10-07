# Bug log

## 2026-10-07

- Report export: pdfmake 0.3 needs `setFonts(Roboto)` plus a local font access policy on the server; without it PDF generation fails or warns. Covered by export tests (non-empty XLSX ZIP / PDF `%PDF` magic).
- CORS: `@fastify/cors` v11 defaults `methods` to GET/HEAD/POST only, so browser preflight blocked PUT/PATCH/DELETE (edit/save/delete looked silent). Explicit methods + `CORS_ORIGINS` (no `*`), OPTIONS on `onRequest` before auth; renderer API base fixed to `127.0.0.1`; network failures show "Cannot reach the server".
- Dropdowns requested `pageSize` > 100 (API correctly rejects). Fixed with dedicated `/subscribers|plans|areas|collectors/options` (max 50, `?search=`) + reusable async combobox; capped remaining list queries at 100. Area/plan/subscriber edit: close dialog, invalidate, success toast; API `issues` mapped inline. Regression: options without pagination, area edit persists name/description, pageSize>100 still 400.
- Areas create treated blank description poorly; optional description now `""`→null in shared Zod + route + form. VALIDATION_ERROR responses lacked field `issues`; central handler now returns and warn-logs them; forms map to inline errors. Area edit/delete added (delete blocked when subscribers still assigned).
- GCash duplicate-reference insert raised a wrapped Postgres `23505` that the service did not map to 409 until `isUniqueViolation` walked the error cause chain.
- Missing `docs/SPEC.md` at foundation start — implemented from `bcis.mdc` + explicit foundation requirements instead of SPEC sections 2–4 text.
- Role matrix drift vs SPEC 3.1: Administrator had near-Owner rights; Cashier lacked `gcash.verify`; Technician had `report.view`. Fixed matrix + seed replace sync; covered by `packages/shared` permissions tests.
- Sidebar was flat top-level only; SPEC 4.3b needs nested section children. Expanded nav + placeholder routes.
