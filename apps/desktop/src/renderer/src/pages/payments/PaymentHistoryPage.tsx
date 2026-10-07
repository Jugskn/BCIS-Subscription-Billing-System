import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { PaymentListItem } from "@bcis/shared";
import { formatCentavos } from "@bcis/shared";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";

export function PaymentHistoryPage() {
  const { api, can } = useAuth();
  const qc = useQueryClient();
  const [reverseTarget, setReverseTarget] = useState<PaymentListItem | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["payments"],
    queryFn: () => api.listPayments({ page: 1, pageSize: 100 }),
    enabled: can("receivable.view"),
  });

  const reverseMutation = useMutation({
    mutationFn: () => api.reversePayment(reverseTarget!.id, reason),
    onSuccess: async () => {
      setReverseTarget(null);
      setReason("");
      setError(null);
      await qc.invalidateQueries({ queryKey: ["payments"] });
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : "Reversal failed.");
    },
  });

  const columns = useMemo<ColumnDef<PaymentListItem>[]>(
    () => [
      {
        accessorKey: "receivedAt",
        header: "Received",
        cell: ({ row }) =>
          new Date(row.original.receivedAt).toLocaleString("en-PH"),
      },
      {
        accessorKey: "receiptNumber",
        header: "Receipt",
        cell: ({ row }) =>
          row.original.receiptId ? (
            <Link
              to={`/payments/receipts/${row.original.receiptId}`}
              className="font-medium text-burgundy hover:underline"
            >
              {row.original.receiptNumber}
            </Link>
          ) : (
            "—"
          ),
      },
      {
        id: "subscriber",
        header: "Subscriber",
        cell: ({ row }) => (
          <Link
            to={`/subscribers/${row.original.subscriberId}`}
            className="text-burgundy hover:underline"
          >
            {row.original.subscriberAccountNumber}
          </Link>
        ),
      },
      { accessorKey: "method", header: "Method" },
      {
        accessorKey: "amountCentavos",
        header: "Amount",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatCentavos(BigInt(row.original.amountCentavos))}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const p = row.original;
          const canReverse =
            can("payment.reverse") &&
            (p.status === "POSTED" || p.status === "VERIFIED");
          if (!canReverse) return null;
          return (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setReverseTarget(p);
                setReason("");
                setError(null);
              }}
            >
              Reverse
            </Button>
          );
        },
      },
    ],
    [can],
  );

  if (!can("receivable.view")) {
    return (
      <p className="text-sm text-muted">You do not have access to payment history.</p>
    );
  }

  if (listQuery.isError) {
    return (
      <p className="text-sm text-danger">
        {listQuery.error instanceof ApiClientError
          ? listQuery.error.message
          : "Failed to load payments."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Payment History</h1>
        <p className="mt-1 text-sm text-muted">
          Posted and pending payments. Reversal requires permission and a reason.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={listQuery.data?.items ?? []}
        searchPlaceholder="Filter payments…"
        pageSize={20}
      />

      <Dialog
        open={Boolean(reverseTarget)}
        onOpenChange={(open) => {
          if (!open) setReverseTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse payment</DialogTitle>
            <DialogDescription>
              This creates a linked reversal, restores invoice balances, and voids
              the receipt number (it stays reserved).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-ink">
              {reverseTarget?.receiptNumber ?? reverseTarget?.id} —{" "}
              {reverseTarget
                ? formatCentavos(BigInt(reverseTarget.amountCentavos))
                : ""}
            </p>
            <label className="text-sm font-medium text-ink" htmlFor="reason">
              Reason <span className="text-danger">*</span>
            </label>
            <Input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this payment being reversed?"
            />
            {error ? <p className="text-sm text-danger">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReverseTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!reason.trim() || reverseMutation.isPending}
              onClick={() => reverseMutation.mutate()}
            >
              Confirm reversal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
