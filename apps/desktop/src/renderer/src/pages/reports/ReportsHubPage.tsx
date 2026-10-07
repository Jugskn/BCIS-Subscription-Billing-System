import { Link } from "react-router-dom";
import { useAuth } from "@/lib/auth";

const REPORTS: Array<{
  to: string;
  title: string;
  description: string;
  permission?: string;
}> = [
  {
    to: "/reports/collections",
    title: "Daily / Weekly / Monthly / Annual Collection",
    description: "Posted and verified payments for a period.",
  },
  {
    to: "/reports/payment-methods",
    title: "Payment Method Summary",
    description: "Cash, GCash, Bank Transfer, Cheque, Other.",
  },
  {
    to: "/reports/billing-vs-collection",
    title: "Billing vs Collection",
    description: "Billed invoices versus collections by month.",
  },
  {
    to: "/reports/revenue",
    title: "Revenue by Plan / Service / Area",
    description: "Invoice totals grouped by plan, service type, or area.",
  },
  {
    to: "/reports/ar-aging",
    title: "AR Aging",
    description: "Current, 1-30, 31-60, 61-90, 90+ open balances.",
  },
  {
    to: "/reports/subscribers",
    title: "Subscriber Master List",
    description: "Subscriber directory with area and collector.",
  },
  {
    to: "/reports/ledger",
    title: "Subscriber Ledger / SOA",
    description: "Opening balance, debits, credits, running balance.",
  },
  {
    to: "/reports/collectors",
    title: "Collector Remittance & Performance",
    description: "Collected, remitted, shortage/overage, performance.",
  },
  {
    to: "/reports/reversals",
    title: "Payment Reversals & Voided Receipts",
    description: "Reversals and voided receipts for a date range.",
  },
  {
    to: "/reports/audit",
    title: "Audit Log & User Activity",
    description: "Read-only audit trail (Owner and Auditor).",
    permission: "audit.view",
  },
  {
    to: "/print/route-sheet",
    title: "Collection Route Sheet (print)",
    description: "Printable route sheet by collection area.",
  },
];

export function ReportsHubPage() {
  const { can } = useAuth();

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Reports</h1>
        <p className="mt-1 text-muted">
          Read-only financial and operational reports. Export requires report.export.
        </p>
      </div>

      <ul className="divide-y divide-border border border-border bg-surface">
        {REPORTS.filter((r) => !r.permission || can(r.permission)).map((r) => (
          <li key={r.to}>
            <Link
              to={r.to}
              className="block px-4 py-3 hover:bg-canvas"
            >
              <p className="font-medium text-ink">{r.title}</p>
              <p className="mt-1 text-muted">{r.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
