# Bug log

## 2026-10-07

- Missing `docs/SPEC.md` at foundation start — implemented from `bcis.mdc` + explicit foundation requirements instead of SPEC sections 2–4 text.
- Role matrix drift vs SPEC 3.1: Administrator had near-Owner rights; Cashier lacked `gcash.verify`; Technician had `report.view`. Fixed matrix + seed replace sync; covered by `packages/shared` permissions tests.
- Sidebar was flat top-level only; SPEC 4.3b needs nested section children. Expanded nav + placeholder routes.
