# BCIS User Manual

Short operator guide for the desktop app. Demo passwords are in the [README](../README.md) (lab only).

## Login

1. Start the API on the server PC, then open the desktop app on your workstation.
2. Sign in with your username and password.
3. After five failed attempts (default), the account locks for 15 minutes.
4. Use **Lock** / **Logout** from the app chrome when leaving the desk. Logout ends the server session (JWT invalidated via `session_version`).

If the login screen shows “Cannot reach the server”, see [Troubleshooting](#troubleshooting).

## Subscriber registration

1. Open **Subscribers → New** (needs `subscriber.create`).
2. Enter name, address, contact, due day, collection area, and optional collector.
3. Select the **service(s)** the subscriber intends to subscribe to from the available services list. Chosen services appear on the receipt.
4. Save — the system assigns a unique `SUB-######` account number.
5. Add one or more **service accounts** (plan, installation address, activation/billing start, due day). Each gets `SVC-######`; the plan rate is snapshotted and will not change if the plan price is edited later.
6. Do not delete subscribers; set status to INACTIVE / TERMINATED / ARCHIVED when ending service.

Search works by account number, name, contact, and address (**Subscribers → All** / global search).

## Generate billing

1. Open **Billing → Generate** (`billing.generate`).
2. Choose the billing period (`YYYY-MM`), run **Preview**, then **Generate**.
3. One invoice is created per eligible ACTIVE service account. Re-running the same period skips accounts that already have a non-void invoice.
4. Review results under **Billing → Invoices** or the subscriber’s **Billing** tab.

Void or adjust only with an audited reason (`billing.void`).

## Receive payment

1. Open **Payments → Receive** (`payment.create`).
2. Search the subscriber, confirm open balance, enter amount and method (**Cash**, **Bank Transfer**, **Cheque**, **GCash**, **Other**).
3. Review the allocation preview (oldest unpaid invoices first). Authorized users may use manual allocation when permitted.
4. Post — a receipt (`RCPT-######`) is issued. Partial payments leave invoices PARTIALLY_PAID; overpayment becomes subscriber credit for future bills.
5. Print the receipt from the success screen / receipt route.

To correct a mistake: use **Reverse** on payment history (`payment.reverse`) with a reason. The original stays visible; balances are restored. Do not expect a delete.

## GCash verification

1. Record the customer’s Facebook proof under **Payments → GCash** (or via receive flow that creates a **PENDING** GCash payment with reference + proof image). Uploading proof alone does **not** mark the account paid.
2. Open **Payments → GCash Verification** (`gcash.verify`).
3. Select a pending item, review proof + reference, then **Verify** (posts and allocates) or **Reject** (`gcash.reject`, frees the reference).
4. Duplicate GCash references among pending/verified payments are blocked.

## Collection batch remittance

1. **Collections → Batches**: create a batch for a collector/area (`collection.create`). State starts **OPEN**.
2. **Start** → **IN_PROGRESS**; record collections against accounts; **Submit**.
3. **Remit**: enter cash remitted. If remitted ≠ cash collected, you must enter a shortage/overage reason.
4. **Reconcile** (`collection.reconcile`) → **Close** (`collection.close`). A non-balanced batch cannot close without a recorded reason.

Route sheets: **Reports → Route sheet** (or collections report path) for printable account/due lists.

## Reports

Open **Reports** (`report.view`). Common reports: collections, payment methods, billing vs collection, revenue, AR aging, subscribers, ledger/SOA, collectors, reversals, audit.

- Preview in-app; **Export** needs `report.export` (XLSX / PDF / CSV where offered).
- Money appears in pesos in exports; the database stores centavos.

## Backup and restore

Requires Owner-level backup permissions (`backup.create` / `backup.restore`).

1. **Administration → Backups**: create a backup (`pg_dump` + attachments copy under `BACKUPS_DIR`).
2. **Verify** the backup (checksum + `pg_restore --list`) before trusting it.
3. **Restore**: type `RESTORE` to confirm. The API takes a pre-restore safety backup, then restores. Other writes return 503 while restore is in progress.

Schedule and server install details: [deployment-guide.md](./deployment-guide.md).

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| **Cannot reach the server** | API running on port 3001? Desktop `BCIS_API_BASE_URL` points at the server (use `http://127.0.0.1:3001` locally, or the server’s static IP)? Firewall allowing TCP 3001? |
| **Validation issues** | API returns `VALIDATION_ERROR` with `issues: [{ field, message }]`. Fix the named fields; empty optional text is fine. |
| **CORS / browser or Electron blocked** | API and client must agree on origin. Defaults allow Vite `localhost`/`127.0.0.1:5173` and Electron `file://` / `null`. Prefer `127.0.0.1` not `localhost` for the API URL. Set `CORS_ORIGINS` if you add hosts. |
| **pageSize / empty list** | List APIs cap `pageSize` at **100** (default 20). Requesting more than 100 fails validation. Use pagination or `/…/options` pickers (capped ~50) for comboboxes. |
| **403 Forbidden** | Role lacks permission — UI may hide buttons, but the API always enforces RBAC. |
| **Account locked** | Wait out lockout or have an Owner unlock / wait `LOGIN_LOCKOUT_MINUTES`. |
| **Backup failed** | Ensure `pg_dump`/`pg_restore` are installed (`PG_BIN_DIR` on Windows if needed). |
