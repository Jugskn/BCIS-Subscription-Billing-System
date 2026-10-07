import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { formatCentavos } from "@bcis/shared";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";

export function SoaPrintPage() {
  const { subscriberId } = useParams<{ subscriberId: string }>();
  const [params] = useSearchParams();
  const fromDate = params.get("fromDate") ?? "";
  const toDate = params.get("toDate") ?? "";
  const { api, can } = useAuth();

  const q = useQuery({
    queryKey: ["soa-print", subscriberId, fromDate, toDate],
    queryFn: () => api.getStatementOfAccount(subscriberId!, fromDate, toDate),
    enabled: Boolean(subscriberId && fromDate && toDate) && can("receivable.view"),
  });

  if (!can("receivable.view")) {
    return <p className="p-6 text-sm text-muted">No access.</p>;
  }

  if (!fromDate || !toDate) {
    return (
      <p className="p-6 text-sm text-danger">
        fromDate and toDate query params are required.
      </p>
    );
  }

  if (q.isLoading) return <p className="p-6 text-sm text-muted">Loading…</p>;
  if (q.isError || !q.data) {
    return (
      <p className="p-6 text-sm text-danger">
        {q.error instanceof ApiClientError
          ? q.error.message
          : "Cannot reach the server"}
      </p>
    );
  }

  const soa = q.data;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 print:max-w-none print:p-0">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link to="/reports/ledger" className="text-sm text-burgundy hover:underline">
          ← Ledger report
        </Link>
        <Button type="button" onClick={() => window.print()}>
          Print statement
        </Button>
      </div>

      <article className="border border-border bg-surface p-8 print:border-0">
        <header className="mb-6 border-b border-border pb-4 text-center">
          <p className="text-xs uppercase tracking-wide text-muted">
            Bukidnon Cable and Internet Services
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">
            Statement of Account
          </h1>
          <p className="mt-2 text-sm text-ink">
            {soa.accountNumber} — {soa.subscriberName}
          </p>
          <p className="mt-1 text-sm text-muted">
            {soa.fromDate} to {soa.toDate}
          </p>
        </header>

        <dl className="mb-4 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">Opening balance</dt>
          <dd className="text-right tabular-nums">
            {formatCentavos(BigInt(soa.openingBalanceCentavos))}
          </dd>
          <dt className="text-muted">Closing balance</dt>
          <dd className="text-right font-medium tabular-nums">
            {formatCentavos(BigInt(soa.closingBalanceCentavos))}
          </dd>
        </dl>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1 font-medium">Date</th>
              <th className="py-1 font-medium">Description</th>
              <th className="py-1 text-right font-medium">Debit</th>
              <th className="py-1 text-right font-medium">Credit</th>
              <th className="py-1 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {soa.entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 text-center text-muted">
                  No ledger entries in this range.
                </td>
              </tr>
            ) : (
              soa.entries.map((e) => (
                <tr key={e.id} className="border-b border-border">
                  <td className="py-1">{e.entryDate}</td>
                  <td className="py-1">{e.description}</td>
                  <td className="py-1 text-right tabular-nums">
                    {formatCentavos(BigInt(e.debitCentavos))}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {formatCentavos(BigInt(e.creditCentavos))}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {formatCentavos(BigInt(e.balanceCentavos))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </article>
    </div>
  );
}
