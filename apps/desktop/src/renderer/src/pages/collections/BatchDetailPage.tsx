import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { formatCentavos, pesosToCentavos } from "@bcis/shared";
import { StatusBadge } from "@/components/status-badge";
import { TabEmptyState } from "@/components/tab-empty-state";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ApiClientError,
  type CollectionBatchAccount,
  type CollectionBatchStatus,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";

function Money({ value }: { value: string }) {
  return (
    <span className="tabular-nums">{formatCentavos(BigInt(value))}</span>
  );
}

export function BatchDetailPage() {
  const { id = "" } = useParams();
  const { api, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [account, setAccount] = useState<CollectionBatchAccount | null>(null);
  const [method, setMethod] = useState<"Cash" | "GCash">("Cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [senderName, setSenderName] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const batch = useQuery({
    queryKey: ["collection-batch", id],
    queryFn: () => api.getCollectionBatch(id),
    enabled: Boolean(id),
  });

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["collection-batch", id] }),
      qc.invalidateQueries({ queryKey: ["collection-batches"] }),
    ]);
  };

  const transition = useMutation({
    mutationFn: async (status: CollectionBatchStatus) => {
      if (status === "IN_PROGRESS") return api.startCollectionBatch(id);
      if (status === "SUBMITTED") return api.submitCollectionBatch(id);
      if (status === "RECONCILED") return api.reconcileCollectionBatch(id);
      if (status === "CLOSED") return api.closeCollectionBatch(id);
      throw new Error("Unsupported transition");
    },
    onSuccess: async () => {
      setError(null);
      await refresh();
      toast.success("Batch status updated.");
    },
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : "Status update failed."),
  });

  const record = useMutation({
    mutationFn: async () => {
      if (!account) throw new Error("Select an account.");
      if (method === "GCash") {
        if (!proof || !reference.trim() || !senderName.trim()) {
          throw new Error("Reference, sender name, and proof are required for GCash.");
        }
        return api.recordGCash({
          subscriberId: account.subscriberId,
          amount,
          referenceNumber: reference,
          senderName,
          notes: `Collection batch ${batch.data?.batchNumber}. ${notes}`.trim(),
          idempotencyKey: crypto.randomUUID(),
          proof,
        });
      }

      const payment = await api.postPayment({
        subscriberId: account.subscriberId,
        amount,
        method: "Cash",
        notes: `Collection batch ${batch.data?.batchNumber}. ${notes}`.trim(),
        idempotencyKey: crypto.randomUUID(),
      });
      await api.recordBatchCollection(id, {
        subscriberId: account.subscriberId,
        serviceAccountId: account.serviceAccountId,
        collectedCentavos: pesosToCentavos(amount).toString(),
        paymentId: payment.payment.id,
        isCash: true,
        notes: notes || undefined,
      });
      return payment.payment;
    },
    onSuccess: async () => {
      const wasGcash = method === "GCash";
      setAccount(null);
      setAmount("");
      setReference("");
      setSenderName("");
      setProof(null);
      setNotes("");
      setError(null);
      await refresh();
      toast.success(
        wasGcash
          ? "GCash proof submitted. It will count only after verification."
          : "Cash collection recorded.",
      );
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Collection could not be recorded."),
  });

  if (batch.isLoading) return <p className="text-sm text-muted">Loading batch…</p>;
  if (batch.isError || !batch.data) {
    return (
      <p className="text-sm text-danger">
        {batch.error instanceof ApiClientError
          ? batch.error.message
          : "Could not load collection batch."}
      </p>
    );
  }

  const data = batch.data;
  const printParams = new URLSearchParams({
    collectionAreaId: data.collectionAreaId ?? "",
    collectorUserId: data.collectorUserId,
  });
  const canRecord =
    can("collection.create") &&
    (data.status === "OPEN" || data.status === "IN_PROGRESS");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/collections/batches" className="text-sm text-burgundy hover:underline">
            ← Collection batches
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-ink">{data.batchNumber}</h1>
            <StatusBadge status={data.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {data.collectorName ?? "Unassigned"} · {data.collectionAreaName ?? "No area"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.collectionAreaId ? (
            <Button asChild variant="outline">
              <Link to={`/print/route-sheet?${printParams.toString()}`}>
                Print route sheet
              </Link>
            </Button>
          ) : null}
          {data.status === "OPEN" && can("collection.create") ? (
            <Button onClick={() => transition.mutate("IN_PROGRESS")}>Start batch</Button>
          ) : null}
          {data.status === "IN_PROGRESS" && can("collection.create") ? (
            <Button onClick={() => transition.mutate("SUBMITTED")}>Submit batch</Button>
          ) : null}
          {data.status === "SUBMITTED" && can("collection.reconcile") ? (
            <Button asChild>
              <Link to={`/collections/remittance?batchId=${data.id}`}>Enter remittance</Link>
            </Button>
          ) : null}
          {data.status === "REMITTED" && can("collection.reconcile") ? (
            <Button onClick={() => transition.mutate("RECONCILED")}>Reconcile</Button>
          ) : null}
          {data.status === "RECONCILED" && can("collection.reconcile") ? (
            <Button onClick={() => transition.mutate("CLOSED")}>Close batch</Button>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Expected", data.expectedCashCentavos],
          ["Cash collected", data.collectedCashCentavos],
          ["Non-cash", data.collectedNonCashCentavos],
          ["Remitted", data.remittedCashCentavos ?? "0"],
        ].map(([label, value]) => (
          <div key={label} className="border border-border bg-surface p-3">
            <p className="text-sm text-muted">{label}</p>
            <p className="mt-1 text-right font-medium text-ink">
              <Money value={value!} />
            </p>
          </div>
        ))}
      </div>

      {data.accounts.length === 0 ? (
        <TabEmptyState
          title="No accounts in this batch"
          description="Create a new batch from a populated collection route."
        />
      ) : (
        <div className="overflow-auto rounded-md border border-border bg-surface">
          <table className="min-w-full text-sm">
            <thead className="border-b border-border text-left text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Subscriber</th>
                <th className="px-3 py-2 font-medium">Address</th>
                <th className="px-3 py-2 text-right font-medium">Amount due</th>
                <th className="px-3 py-2 text-right font-medium">Collected</th>
                <th className="px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((item) => (
                <tr key={item.id} className="border-b border-border">
                  <td className="px-3 py-2">{item.subscriberAccountNumber}</td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/subscribers/${item.subscriberId}`}
                      className="text-burgundy hover:underline"
                    >
                      {item.subscriberName}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{item.subscriberAddress}</td>
                  <td className="px-3 py-2 text-right"><Money value={item.expectedCentavos} /></td>
                  <td className="px-3 py-2 text-right"><Money value={item.collectedCentavos} /></td>
                  <td className="px-3 py-2">
                    {canRecord && BigInt(item.collectedCentavos) === 0n ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAccount(item);
                          setAmount(
                            `${BigInt(item.expectedCentavos) / 100n}.${(
                              BigInt(item.expectedCentavos) % 100n
                            ).toString().padStart(2, "0")}`,
                          );
                          setError(null);
                        }}
                      >
                        Record collection
                      </Button>
                    ) : item.paymentId ? (
                      <Link
                        to={`/payments/history`}
                        className="text-burgundy hover:underline"
                      >
                        Payment posted
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={account !== null} onOpenChange={(open) => !open && setAccount(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record collection</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted">
              {account?.subscriberAccountNumber} — {account?.subscriberName}
            </p>
            <div className="space-y-2">
              <Label htmlFor="collection-method">Method</Label>
              <select
                id="collection-method"
                className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
                value={method}
                onChange={(event) => setMethod(event.target.value as "Cash" | "GCash")}
              >
                <option value="Cash">Cash</option>
                <option value="GCash">GCash</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="collection-amount">Amount (PHP)</Label>
              <Input
                id="collection-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="tabular-nums"
              />
            </div>
            {method === "GCash" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="gcash-reference">GCash reference</Label>
                  <Input id="gcash-reference" value={reference} onChange={(event) => setReference(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gcash-sender">Sender name</Label>
                  <Input id="gcash-sender" value={senderName} onChange={(event) => setSenderName(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gcash-proof">Proof</Label>
                  <Input
                    id="gcash-proof"
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    onChange={(event) => setProof(event.target.files?.[0] ?? null)}
                  />
                </div>
                <p className="text-sm text-warning">
                  GCash remains pending and is not counted until an authorized verifier approves it.
                </p>
              </>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="collection-notes">Notes</Label>
              <Input id="collection-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <Button
              type="button"
              disabled={!amount || record.isPending}
              onClick={() => record.mutate()}
            >
              {record.isPending
                ? "Saving…"
                : method === "GCash"
                  ? "Submit proof"
                  : "Post and record"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
