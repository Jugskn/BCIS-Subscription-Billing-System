import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { formatCentavos } from "@bcis/shared";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";

export function ReceiptPrintPage() {
  const { id } = useParams<{ id: string }>();
  const { api, can } = useAuth();

  const receiptQuery = useQuery({
    queryKey: ["receipt", id],
    queryFn: () => api.getReceipt(id!),
    enabled: Boolean(id) && can("receivable.view"),
  });

  if (!can("receivable.view")) {
    return <p className="text-sm text-muted">You do not have access to receipts.</p>;
  }

  if (receiptQuery.isLoading) {
    return <p className="text-sm text-muted">Loading receipt…</p>;
  }

  if (receiptQuery.isError || !receiptQuery.data) {
    return (
      <p className="text-sm text-danger">
        {receiptQuery.error instanceof ApiClientError
          ? receiptQuery.error.message
          : "Receipt not found."}
      </p>
    );
  }

  const r = receiptQuery.data;
  const isVoid = r.status === "VOID";

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6 print:max-w-none print:p-0">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link to="/payments/history" className="text-sm text-burgundy hover:underline">
          ← Payment history
        </Link>
        <Button type="button" onClick={() => window.print()}>
          Print receipt
        </Button>
      </div>

      <article className="relative border border-border bg-surface p-8 print:border-0">
        {isVoid ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <span className="rotate-[-18deg] text-6xl font-bold tracking-widest text-danger/25">
              VOID
            </span>
          </div>
        ) : null}

        <header className="mb-6 border-b border-border pb-4 text-center">
          <p className="text-xs uppercase tracking-wide text-muted">
            Bukidnon Cable and Internet Services
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">Official Receipt</h1>
          <p className="mt-2 text-lg font-medium tabular-nums text-ink">
            {r.receiptNumber}
          </p>
          {isVoid ? (
            <p className="mt-2 text-base font-bold uppercase tracking-wide text-danger">
              VOID — this receipt is not valid
            </p>
          ) : null}
        </header>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Date</dt>
          <dd className="text-right text-ink">
            {new Date(r.issuedAt).toLocaleString("en-PH")}
          </dd>
          <dt className="text-muted">Account</dt>
          <dd className="text-right text-ink">{r.subscriberAccountNumber}</dd>
          <dt className="text-muted">Subscriber</dt>
          <dd className="text-right text-ink">{r.subscriberName}</dd>
          <dt className="text-muted">Address</dt>
          <dd className="text-right text-ink">{r.subscriberAddress}</dd>
          <dt className="text-muted">Method</dt>
          <dd className="text-right text-ink">{r.paymentMethod}</dd>
          {r.referenceNumber ? (
            <>
              <dt className="text-muted">Reference</dt>
              <dd className="text-right text-ink">{r.referenceNumber}</dd>
            </>
          ) : null}
          <dt className="text-muted">Cashier</dt>
          <dd className="text-right text-ink">{r.issuedByName ?? "—"}</dd>
        </dl>

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1 font-medium">Invoice</th>
              <th className="py-1 font-medium">Period</th>
              <th className="py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {r.allocations.map((a) => (
              <tr key={`${a.invoiceNumber}-${a.billingPeriod}`} className="border-b border-border">
                <td className="py-1">{a.invoiceNumber}</td>
                <td className="py-1">{a.billingPeriod}</td>
                <td className="py-1 text-right tabular-nums">
                  {formatCentavos(BigInt(a.amountCentavos))}
                </td>
              </tr>
            ))}
            {BigInt(r.unallocatedCentavos) > 0n ? (
              <tr className="border-b border-border">
                <td className="py-1" colSpan={2}>
                  Unapplied credit
                </td>
                <td className="py-1 text-right tabular-nums">
                  {formatCentavos(BigInt(r.unallocatedCentavos))}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <dl className="mt-6 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">Total paid</dt>
          <dd className="text-right text-lg font-semibold tabular-nums text-ink">
            {formatCentavos(BigInt(r.amountCentavos))}
          </dd>
          <dt className="text-muted">Remaining balance</dt>
          <dd className="text-right font-medium tabular-nums text-ink">
            {formatCentavos(BigInt(r.remainingBalanceCentavos))}
          </dd>
        </dl>

        {isVoid && r.voidReason ? (
          <p className="mt-4 text-sm text-danger">Void reason: {r.voidReason}</p>
        ) : null}
      </article>
    </div>
  );
}
