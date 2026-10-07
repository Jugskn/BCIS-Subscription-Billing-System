import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatCentavos } from "@bcis/shared";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { api, can } = useAuth();
  const qc = useQueryClient();
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const invoiceQuery = useQuery({
    queryKey: ["invoice", id],
    queryFn: () => api.getInvoice(id!),
    enabled: Boolean(id),
  });

  const voidMutation = useMutation({
    mutationFn: () => api.voidInvoice(id!, voidReason),
    onSuccess: async () => {
      setVoidOpen(false);
      await qc.invalidateQueries({ queryKey: ["invoice", id] });
      await qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });

  const adjustMutation = useMutation({
    mutationFn: () => api.adjustInvoice(id!, adjustAmount, adjustReason),
    onSuccess: async () => {
      setAdjustOpen(false);
      setAdjustAmount("");
      setAdjustReason("");
      await qc.invalidateQueries({ queryKey: ["invoice", id] });
      await qc.invalidateQueries({ queryKey: ["invoices"] });
    },
  });

  if (invoiceQuery.isLoading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  if (invoiceQuery.isError || !invoiceQuery.data) {
    return (
      <p className="text-sm text-danger">
        {invoiceQuery.error instanceof ApiClientError
          ? invoiceQuery.error.message
          : "Invoice not found."}
      </p>
    );
  }

  const invoice = invoiceQuery.data;
  const canVoid = can("billing.void") && invoice.status !== "VOID";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">
            <Link to="/billing/invoices" className="text-burgundy hover:underline">
              Invoices
            </Link>
          </p>
          <h1 className="mt-1 font-mono text-2xl font-semibold text-ink">
            {invoice.invoiceNumber}
          </h1>
          <div className="mt-2">
            <StatusBadge status={invoice.status} />
          </div>
        </div>
        {canVoid ? (
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setAdjustOpen(true)}>
              Adjust
            </Button>
            <Button type="button" variant="danger" size="sm" onClick={() => setVoidOpen(true)}>
              Void
            </Button>
          </div>
        ) : null}
      </div>

      <dl className="grid max-w-3xl gap-4 sm:grid-cols-2 text-sm">
        <Field label="Subscriber" value={invoice.subscriberName} />
        <Field label="Service account" value={invoice.serviceAccountNumber} />
        <Field label="Billing period" value={invoice.billingPeriod} />
        <Field label="Due date" value={invoice.dueDate} />
        <Field
          label="Total"
          value={formatCentavos(BigInt(invoice.totalCentavos))}
          numeric
        />
        <Field
          label="Balance"
          value={formatCentavos(BigInt(invoice.balanceCentavos))}
          numeric
        />
        <Field
          label="Credit applied"
          value={formatCentavos(BigInt(invoice.creditAppliedCentavos))}
          numeric
        />
        {invoice.voidReason ? (
          <Field label="Void reason" value={invoice.voidReason} className="sm:col-span-2" />
        ) : null}
      </dl>

      <div>
        <h2 className="mb-2 text-sm font-medium text-ink">Line items</h2>
        <div className="overflow-auto rounded-md border border-border">
          <table className="min-w-full text-sm">
            <thead className="bg-surface">
              <tr className="border-b border-border text-left text-muted">
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Rate</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item) => (
                <tr key={item.id} className="border-b border-border">
                  <td className="px-3 py-2">{item.itemType}</td>
                  <td className="px-3 py-2">{item.description}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCentavos(BigInt(item.rateCentavos))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCentavos(BigInt(item.amountCentavos))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void invoice</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted">
            This posts offsetting ledger entries. Reason is required and audited.
          </p>
          <Input
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="Reason for void…"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setVoidOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={!voidReason.trim() || voidMutation.isPending}
              onClick={() => voidMutation.mutate()}
            >
              Void invoice
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust invoice</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted">
            Positive amount adds a charge; negative amount credits the invoice.
          </p>
          <Input
            value={adjustAmount}
            onChange={(e) => setAdjustAmount(e.target.value)}
            placeholder="Amount (e.g. 50.00 or -25.00)"
          />
          <Input
            value={adjustReason}
            onChange={(e) => setAdjustReason(e.target.value)}
            placeholder="Reason…"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAdjustOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                !adjustReason.trim() || !adjustAmount.trim() || adjustMutation.isPending
              }
              onClick={() => adjustMutation.mutate()}
            >
              Post adjustment
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  value,
  numeric,
  className,
}: {
  label: string;
  value: string;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`mt-1 ${numeric ? "tabular-nums" : ""}`}>{value}</dd>
    </div>
  );
}
