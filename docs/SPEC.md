BCIS Subscription Billing and Collection System: SPEC

Bukidnon Cable and Internet Services (BCIS). Windows desktop system for 3 simultaneous office PCs. Architecture: Electron clients -> Fastify API -> PostgreSQL. This is NOT a CRUD project: financial correctness, history preservation, concurrency, and security matter most.

2. Architecture Rules
Renderer never connects to PostgreSQL. All data access goes through the API.
Electron: contextIsolation=true, nodeIntegration=false, narrow typed preload API only.
Validate all external input with Zod.
Business rules live in API services/domain logic, not in React.
Multi-step financial posting uses PostgreSQL transactions.
Money: integer centavos (or exact NUMERIC). Never JS floats for authoritative amounts.
Every schema change is a migration.
Posted financial records are reversed or adjusted, never silently deleted or overwritten.
3. Functional Scope
3.1 Roles
Role	Minimum capabilities
Owner / Super Admin	Dashboards, reports, approvals, configuration, users, audit, backup/restore
Administrator	Subscribers, plans, service accounts, billing, collections, operational reports
Cashier	Subscriber search, receive payment, issue receipt, view balances, approved GCash processing
Collection Supervisor	Areas/routes, batches, remittance, reconciliation, collector performance
Accounting / Auditor	Reports, adjustment/reversal review, receivables, audit trails
Technician	Service account and suspension/reconnection operational info only
Read-only Viewer	Dashboards and reports, no mutations
3.2 Subscriber Management
Subscriber identity, unique account number, contacts, address, collection area, assigned collector, billing/due day, status, notes.
One subscriber may own multiple service accounts/addresses.
Global search by: account number, name, contact number, address, receipt number, invoice number, GCash reference.
Never delete subscribers. Use INACTIVE / TERMINATED / ARCHIVED.
3.3 Plans and Service Accounts
Internet, Cable, Combo plans: code, name, price, fees, description, active flag. Internet may have speed; Cable may have channel count.
Service account: plan, installation address, activation date, billing start date, billing/due day, current rate, status, assigned collector.
Plan price changes affect future billing only. Historical invoices keep billed rates.
3.4 Billing and Invoices
Generate monthly invoices per active service account.
States: DRAFT, UNPAID, PARTIALLY_PAID, PAID, OVERDUE, VOID, CREDITED.
Items: subscription charge, installation/reconnection fee, discount, penalty (if enabled), debit/credit adjustments, total.
Finalized invoices are immutable except via controlled adjustment/void workflows.
Prevent duplicate billing for same service account + billing period.
3.5 Subscriber Ledger
Complete chronological debit/credit history with reproducible running balance.
Columns: Date, Reference, Description, Debit, Credit, Balance.
Example: INV-1001 debit 999 -> balance 999; RCPT-5001 credit 500 -> 499; RCPT-5110 credit 499 -> 0.
Printable Statement of Account (SOA) for a selected date range.
3.6 Payments and Allocation
Methods: Cash, GCash, Bank Transfer, Cheque, Other.
Capture: date/time, amount, receipt number, actor, method, reference number, notes, optional proof attachment.
Exact, partial, and advance payments supported.
Default allocation: oldest unpaid invoice first. Manual allocation only for authorized users when business rule permits.
Posted payments are corrected by reversal, not destructive editing.
3.7 GCash Verification
Customer sends proof to the BCIS Facebook Page.
Staff records transaction reference, sender details, amount, proof image.
System checks for duplicate references.
Authorized staff verifies or rejects the proof.
Only VERIFIED payments are posted and allocated.
Verifier identity and timestamp are retained.
A screenshot is evidence, not proof. Uploading an image must never mark an account paid.
3.8 House-to-House Collection
Collection areas/routes; subscribers assigned to collectors.
Printable route sheets: account, address, current bill, arrears, total due.
Batch states: OPEN, IN_PROGRESS, SUBMITTED, REMITTED, RECONCILED, CLOSED.
Summarize expected receivable, cash collected, GCash/non-cash collected, uncollected.
Reconcile remittance; explicitly record shortage/overage when totals differ.
Authorized confirmation required to close a reconciled batch.
3.9 Receivables and Overdue
Dashboard: current receivable, overdue receivable, subscribers overdue, accounts for follow-up/suspension.
AR aging buckets: Current, 1-30, 31-60, 61-90, 90+ days.
Overdue list columns: subscriber, service, area, collector, months unpaid, oldest unpaid invoice, last payment, total arrears.
Filters: collector, area, plan, service type, delinquency age.
3.10 Suspension and Reconnection
Configurable grace period and suspension threshold.
Suspension record: reason, effective date, approved by, notes.
After qualifying payment: reconnection workflow with optional fee, technician assignment, request date, completion date.
All service state changes stay in service history.
3.11 Receipts and Reports
Unique receipt numbers; voided receipts stay in history; numbers never reused.cw1
Reports: daily/weekly/monthly/annual collection; payment-method summaries; billing vs collection; revenue by plan/service/area; AR; subscriber master list; subscriber ledger and SOA; collector assignment/collection/remittance/shortage-overage/performance; payment adjustment, reversal, voided receipt, user activity, audit.
Export to PDF and XLSX (CSV optional).
4. UI, Security, Reliability
4.3 Screens
Dashboard: 4-6 compact KPIs, billing vs collection, payment method summary, AR aging, collector performance, overdue alerts, recent payments.
Subscriber Profile tabs: overview, services, billing, payments, ledger, collection, service history, documents, audit.
Receive Payment: cashier speed: search, balance, amount, method, allocation preview, post, print receipt.
GCash Verification: two-pane queue with proof preview and verification controls.
Collector Reconciliation: expected cash, remitted cash, difference, non-cash totals, accounts collected, exceptions.
Tables: sticky headers, search, filters, sorting, pagination, export, consistent badges.
Forms: visible labels, required indicators, grouped sections, inline validation.
Printing: clean print layout without app navigation.
Financial values right-aligned with tabular numerals. Status = text + color, never color alone.
4.3b Navigation

Dashboard; Subscribers (All, New, Service Accounts); Billing (Current, Generate, Invoices); Payments (Receive, History, GCash Verification); Collections (Collectors, Areas & Routes, Batches, Remittance); Receivables (Outstanding, Overdue, Aging, Suspension Candidates); Services; Reports; Administration.

4.4 Security and Audit
Username/password auth, secure hashing, active/inactive accounts.
Granular RBAC, e.g. subscriber.view, billing.generate, payment.create, payment.reverse, collection.reconcile, report.export, user.manage, backup.restore.
Server-side authorization on every route.
Every posted financial mutation writes an audit record: actor, action, timestamp, reason, old/new values.
Audit logs not editable from the app.
Validate proof uploads by type, size, safe storage path.
Never log passwords/secrets.
Session lock/logout; sensible failed-login handling.
4.5 Reliability and Performance
Target scale: 20,000 subscribers, 500,000 invoices, 500,000 payments, 1,000,000 ledger entries.
Indexes + server-side pagination; never load full datasets into the renderer.
Critical financial operations are all-or-nothing transactions.
Database + attachment backup, backup verification, restore workflow.
Friendly user error messages; technical detail goes to structured logs.
5. Data Model
Domain	Tables / Entities
Security	users, roles, permissions, role_permissions, user_roles
Subscribers	subscribers, subscriber_addresses/contact data
Services	service_types, service_plans, service_accounts, service_events
Billing	billing_cycles, invoices, invoice_items, adjustments
Payments	payments, payment_allocations, payment_proofs, payment_reversals
Collections	collection_areas, collector_assignments, collection_batches, batch_accounts, collector_remittances
Documents	receipts
Operations	suspension_records, reconnection_records
System	audit_logs, application_settings, backup_history

Relationships:

Subscriber 1--< ServiceAccount 1--< Invoice 1--< InvoiceItem
Invoice >--< Payment (via PaymentAllocation)
Collector 1--< CollectionBatch 1--< CollectionBatchAccount
Payment 1--< PaymentProof / PaymentReversal
ServiceAccount 1--< ServiceEvent / Suspension / Reconnection

Minimum constraints:

Unique subscriber account number; unique service account number.
Unique invoice number; no duplicate billing period per service account.
Unique receipt number; voided numbers stay reserved.
GCash reference uniqueness or controlled duplicate detection.
Foreign keys on all owned records.
Indexes: subscriber name/account/contact, invoice due date/status, payment date/reference, collector, collection area.
7. Mandatory Acceptance Tests
ID	Scenario	Test data	Expected result
AT-01	Exact payment	Invoice 999; pay 999	Remaining 0; PAID; ledger balanced; receipt created
AT-02	Partial payment	Invoice 999; pay 500	Remaining 499; PARTIALLY_PAID; allocation and ledger correct
AT-03	Advance payment	Monthly 1,000; pay 3,000	Allocation/credit follows documented policy; no value lost
AT-04	Oldest-first arrears	Aug 999 + Sep 999; pay 1,200	Aug 0; Sep 798 remaining
AT-05	Duplicate GCash ref	Post already-used verified ref	Blocked or warned per documented policy
AT-06	Payment reversal	Reverse incorrect payment	Original visible; linked reversal; balances restored; actor/reason audited
AT-07	Balanced remittance	Collected 20,000; remitted 20,000	Difference 0; batch can reconcile/close
AT-08	Collector shortage	Collected 20,000; remitted 19,500	500 shortage shown; cannot silently close as balanced
AT-09	Concurrent users	2-3 PCs post/read different valid operations	No corruption, duplicate numbering, or cross-session effect
AT-10	Authorization	Cashier tries admin-only user/backup op	Server rejects even when API called directly
AT-11	Duplicate billing	Run billing generation twice for same period	No duplicate finalized invoice per service account/period
AT-12	Backup/restore	Backup, change data, restore	Restored DB passes integrity check; expected records return

Required evidence: automated domain tests, API integration tests, E2E or reproducible manual evidence, screenshots/report files with expected balances, bug log (issue, root cause, fix, regression test).

8. Demo Dataset (synthetic only)
Data	Minimum
Users	5 (Admin, Cashier, Collection Supervisor, Auditor/Viewer)
Plans	3 Internet, 2 Cable, 2 Combo
Subscribers	50
Service accounts	60+ across Internet/Cable/Combo
Collectors	2
Collection areas	3
Invoices	At least 3 billing months
Payments	Mix of Cash, GCash, partial, exact, advance
Overdue accounts	10+ spanning multiple aging buckets
Reversal/void	At least 1
Suspension/reconnection	At least 2 scenarios

Use synthetic data only: Real-world names, phone numbers, GCash details, or passwords.

Critical failures (never do these)

Destructive deletion of posted payments; wrong ledger balances; shared database-file architecture; plaintext passwords; renderer direct DB access; no server-side authorization; unable to restore a backup; static UI/CRUD without financial workflows.

Defense questions the design must answer

Why PostgreSQL over shared SQLite; where billing/payment logic lives; how duplicate invoices/receipts/GCash refs are prevented; how a partial payment is stored; why payments are reversed not deleted; how ledger correctness is proven; what happens if the API crashes mid-posting; server authorization vs hidden buttons; how backups are validated/restored; changes needed for a future collector mobile/PWA.