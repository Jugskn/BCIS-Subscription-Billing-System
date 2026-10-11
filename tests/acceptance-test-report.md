# Acceptance test report

Generated: 2026-10-11T02:36:26.494Z

| ID | Scenario | Test data | Expected | Actual | Result | Timestamp |
|----|----------|-----------|----------|--------|--------|-----------|
| AT-01 | Exact payment | Invoice 999; pay 999 | Remaining 0; PAID; ledger balanced; receipt created | Assertions passed | PASS | 2026-10-11T02:36:13.485Z |
| AT-02 | Partial payment | Invoice 999; pay 500 | Remaining 499; PARTIALLY_PAID; allocation and ledger correct | Assertions passed | PASS | 2026-10-11T02:36:13.981Z |
| AT-03 | Advance payment | Monthly 1,000; pay 3,000 | Allocation/credit follows documented policy; no value lost | Assertions passed | PASS | 2026-10-11T02:36:14.235Z |
| AT-04 | Oldest-first arrears | Aug 999 + Sep 999; pay 1,200 | Aug 0; Sep 798 remaining | Assertions passed | PASS | 2026-10-11T02:36:14.417Z |
| AT-05 | Duplicate GCash ref | Post already-used verified ref | Blocked or warned per documented policy | Assertions passed | PASS | 2026-10-11T02:36:14.566Z |
| AT-06 | Payment reversal | Reverse incorrect payment | Original visible; linked reversal; balances restored; actor/reason audited | Assertions passed | PASS | 2026-10-11T02:36:14.767Z |
| AT-07 | Balanced remittance | Collected 20,000; remitted 20,000 | Difference 0; batch can reconcile/close | Assertions passed | PASS | 2026-10-11T02:36:23.586Z |
| AT-08 | Collector shortage | Collected 20,000; remitted 19,500 | 500 shortage shown; cannot silently close as balanced | Assertions passed | PASS | 2026-10-11T02:36:23.633Z |
| AT-09 | Concurrent users | 2-3 PCs post/read different valid operations | No corruption, duplicate numbering, or cross-session effect | Assertions passed | PASS | 2026-10-11T02:36:15.043Z |
| AT-10 | Authorization | Cashier tries admin-only user/backup op | Server rejects even when API called directly | Assertions passed | PASS | 2026-10-11T02:36:18.058Z |
| AT-11 | Duplicate billing | Run billing generation twice for same period | No duplicate finalized invoice per service account/period | Assertions passed | PASS | 2026-10-11T02:36:26.445Z |
| AT-12 | Backup/restore | Backup, change data, restore | Restored DB passes integrity check; expected records return | Assertions passed | PASS | 2026-10-11T02:36:20.368Z |
