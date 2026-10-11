import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { formatCentavos, pesosToCentavos } from "@bcis/shared";
import { StatusBadge } from "@/components/status-badge";
import { TabEmptyState } from "@/components/tab-empty-state";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function Money({ value }: { value: string }) {
  return <span className="tabular-nums">{formatCentavos(BigInt(value))}</span>;
}

function tryCentavos(value: string): bigint | null {
  try {
    return value ? pesosToCentavos(value) : null;
  } catch {
    return null;
  }
}

export function RemittancePage() {
  const { api, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const batchId = searchParams.get("batchId") ?? "";
  const [remitted, setRemitted] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const candidates = useQuery({
    queryKey: ["remittance-candidates"],
    queryFn: async () => {
      const [submitted, remittedRows] = await Promise.all([
        api.listCollectionBatches({ page: 1, pageSize: 100, status: "SUBMITTED" }),
        api.listCollectionBatches({ page: 1, pageSize: 100, status: "REMITTED" }),
      ]);
      return [...submitted.items, ...remittedRows.items];
    },
  });

  const batch = useQuery({
    queryKey: ["collection-batch", batchId],
    queryFn: () => api.getCollectionBatch(batchId),
    enabled: Boolean(batchId),
  });

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["collection-batch", batchId] }),
      qc.invalidateQueries({ queryKey: ["collection-batches"] }),
      qc.invalidateQueries({ queryKey: ["remittance-candidates"] }),
    ]);
  };

  const remit = useMutation({
    mutationFn: () =>
      api.remitCollectionBatch(batchId, {
        remittedCashCentavos: pesosToCentavos(remitted).toString(),
        shortageReason: reason.trim() || undefined,
      }),
    onSuccess: async () => {
      setError(null);
      await refresh();
      toast.success("Remittance recorded.");
    },
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : "Remittance failed."),
  });

  const transition = useMutation({
    mutationFn: async (action: "reconcile" | "close") =>
      action === "reconcile"
        ? api.reconcileCollectionBatch(batchId)
        : api.closeCollectionBatch(batchId),
    onSuccess: async (_, action) => {
      setError(null);
      await refresh();
      toast.success(action === "reconcile" ? "Batch reconciled." : "Batch closed.");
    },
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : "Batch update failed."),
  });

  const data = batch.data;
  const remittedInput = tryCentavos(remitted);
  const inputDifference =
    data && remittedInput !== null
      ? remittedInput - BigInt(data.collectedCashCentavos)
      : null;
  const difference =
    data?.differenceCentavos !== null && data?.differenceCentavos !== undefined
      ? BigInt(data.differenceCentavos)
      : inputDifference;
  const accountsCollected =
    data?.accounts.filter((item) => BigInt(item.collectedCentavos) > 0n).length ?? 0;
  const exceptions =
    data?.accounts.filter(
      (item) => BigInt(item.collectedCentavos) < BigInt(item.expectedCentavos),
    ) ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Collector Remittance</h1>
        <p className="mt-1 text-sm text-muted">
          Compare collected cash with the amount turned over by the collector.
        </p>
      </div>

      <div className="max-w-xl space-y-2">
        <Label htmlFor="remittance-batch">Batch</Label>
        <select
          id="remittance-batch"
          className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
          value={batchId}
          onChange={(event) => setSearchParams({ batchId: event.target.value })}
        >
          <option value="">Select a submitted or remitted batch</option>
          {(candidates.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.batchNumber} — {item.collectorName} — {item.status}
            </option>
          ))}
        </select>
        {candidates.isError ? (
          <p className="text-sm text-danger">
            {candidates.error instanceof ApiClientError
              ? candidates.error.message
              : "Could not load remittance batches."}
          </p>
        ) : null}
      </div>

      {!batchId ? (
        <TabEmptyState
          title="Select a batch"
          description="Only submitted or remitted batches are available for reconciliation."
        />
      ) : batch.isLoading ? (
        <p className="text-sm text-muted">Loading remittance…</p>
      ) : batch.isError || !data ? (
        <p className="text-sm text-danger">
          {batch.error instanceof ApiClientError
            ? batch.error.message
            : "Could not load the selected batch."}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Link
                to={`/collections/batches/${data.id}`}
                className="font-medium text-burgundy hover:underline"
              >
                {data.batchNumber}
              </Link>
              <p className="text-sm text-muted">
                {data.collectorName} · {data.collectionAreaName}
              </p>
            </div>
            <StatusBadge status={data.status} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Expected cash", data.expectedCashCentavos],
              ["Cash collected", data.collectedCashCentavos],
              ["Remitted cash", data.remittedCashCentavos ?? "0"],
              ["Non-cash total", data.collectedNonCashCentavos],
            ].map(([label, value]) => (
              <div key={label} className="border border-border bg-surface p-3">
                <p className="text-sm text-muted">{label}</p>
                <p className="mt-1 text-right font-medium"><Money value={value!} /></p>
              </div>
            ))}
            <div className="border border-border bg-surface p-3">
              <p className="text-sm text-muted">Accounts collected</p>
              <p className="mt-1 text-right font-medium tabular-nums">
                {accountsCollected} / {data.accounts.length}
              </p>
            </div>
          </div>

          {difference !== null && difference !== 0n ? (
            <div
              className={`border p-4 ${
                difference < 0n
                  ? "border-danger/40 text-danger"
                  : "border-warning/40 text-warning"
              }`}
            >
              <p className="font-semibold">
                {difference < 0n ? "SHORTAGE" : "OVERAGE"}:{" "}
                <Money value={(difference < 0n ? -difference : difference).toString()} />
              </p>
              <p className="mt-1 text-sm">
                A reason is required. This batch cannot be treated as balanced.
              </p>
            </div>
          ) : difference === 0n ? (
            <div className="border border-success/40 p-4 text-success">
              <p className="font-semibold">BALANCED</p>
              <p className="mt-1 text-sm">Remitted cash matches collected cash.</p>
            </div>
          ) : null}

          {data.status === "SUBMITTED" && can("collection.reconcile") ? (
            <div className="max-w-xl space-y-4 border border-border bg-surface p-4">
              <div className="space-y-2">
                <Label htmlFor="remitted-cash">Remitted cash (PHP)</Label>
                <Input
                  id="remitted-cash"
                  value={remitted}
                  onChange={(event) => setRemitted(event.target.value)}
                  className="tabular-nums"
                  placeholder="0.00"
                />
              </div>
              {inputDifference !== null && inputDifference !== 0n ? (
                <div className="space-y-2">
                  <Label htmlFor="difference-reason">Shortage/overage reason *</Label>
                  <Input
                    id="difference-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </div>
              ) : null}
              <Button
                type="button"
                disabled={
                  remittedInput === null ||
                  remit.isPending ||
                  (inputDifference !== null && inputDifference !== 0n && !reason.trim())
                }
                onClick={() => remit.mutate()}
              >
                Record remittance
              </Button>
            </div>
          ) : null}

          {data.status === "REMITTED" && can("collection.reconcile") ? (
            <Button type="button" onClick={() => transition.mutate("reconcile")}>
              Reconcile batch
            </Button>
          ) : null}
          {data.status === "RECONCILED" && can("collection.reconcile") ? (
            <Button type="button" onClick={() => transition.mutate("close")}>
              Close batch
            </Button>
          ) : null}

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <section>
            <h2 className="mb-2 font-medium text-ink">Exceptions</h2>
            {exceptions.length === 0 ? (
              <p className="text-sm text-muted">No uncollected or partially collected accounts.</p>
            ) : (
              <div className="overflow-auto border border-border bg-surface">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-border text-left text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Account</th>
                      <th className="px-3 py-2 font-medium">Subscriber</th>
                      <th className="px-3 py-2 text-right font-medium">Expected</th>
                      <th className="px-3 py-2 text-right font-medium">Collected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exceptions.map((item) => (
                      <tr key={item.id} className="border-b border-border">
                        <td className="px-3 py-2">{item.subscriberAccountNumber}</td>
                        <td className="px-3 py-2">{item.subscriberName}</td>
                        <td className="px-3 py-2 text-right"><Money value={item.expectedCentavos} /></td>
                        <td className="px-3 py-2 text-right"><Money value={item.collectedCentavos} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
