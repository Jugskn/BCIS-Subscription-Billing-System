import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { formatCentavos } from "@bcis/shared";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";
import { TabEmptyState } from "@/components/tab-empty-state";

export function AgingPage() {
  const { api, can } = useAuth();
  const q = useQuery({
    queryKey: ["receivables-aging"],
    queryFn: () => api.getReceivablesAging(),
    enabled: can("receivable.view"),
  });

  if (!can("receivable.view")) {
    return <p className="text-sm text-muted">No access to receivables.</p>;
  }

  if (q.isLoading) return <p className="text-sm text-muted">Loading aging…</p>;
  if (q.isError || !q.data) {
    return (
      <p className="text-sm text-danger">
        {q.error instanceof ApiClientError
          ? q.error.message
          : "Cannot reach the server"}
      </p>
    );
  }

  const data = q.data;

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">AR Aging</h1>
          <p className="mt-1 text-muted">
            As of {data.asOfDate} · grace {data.graceDays} days. Totals match the
            dashboard and aging report.
          </p>
        </div>
        <Link to="/reports/ar-aging" className="text-burgundy hover:underline">
          Open full aging report →
        </Link>
      </div>

      {data.totalInvoiceCount === 0 ? (
        <TabEmptyState
          title="No open balances"
          description="There are no open invoice balances to age."
        />
      ) : (
        <table className="w-full border border-border bg-surface">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="px-3 py-2 font-medium">Bucket</th>
              <th className="px-3 py-2 text-right font-medium">Invoices</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {data.buckets.map((b) => (
              <tr key={b.bucket} className="border-b border-border">
                <td className="px-3 py-2">{b.bucket}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {b.invoiceCount}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCentavos(BigInt(b.balanceCentavos))}
                </td>
              </tr>
            ))}
            <tr className="font-medium">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {data.totalInvoiceCount}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCentavos(BigInt(data.totalBalanceCentavos))}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
