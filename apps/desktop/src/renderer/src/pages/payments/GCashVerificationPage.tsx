import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { PaymentDetail, PaymentListItem } from "@bcis/shared";
import { formatCentavos } from "@bcis/shared";
import {
  AsyncCombobox,
  type AsyncComboboxOption,
} from "@/components/async-combobox";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";

export function GCashVerificationPage() {
  const { api, can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);

  // Record form state
  const [subscriberId, setSubscriberId] = useState("");
  const [subscriberLabel, setSubscriberLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [senderName, setSenderName] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);

  const loadSubscribers = useCallback(
    async (search: string): Promise<AsyncComboboxOption[]> => {
      const items = await api.subscriberOptions(search || undefined);
      return items.map((s) => ({
        value: s.id,
        label: `${s.accountNumber} — ${s.fullName}`,
      }));
    },
    [api],
  );

  const queueQuery = useQuery({
    queryKey: ["gcash-pending"],
    queryFn: () => api.listPendingGCash({ page: 1, pageSize: 100 }),
    enabled: can("gcash.verify"),
  });

  const detailQuery = useQuery({
    queryKey: ["payment", selectedId],
    queryFn: () => api.getPayment(selectedId!),
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    let revoke: string | null = null;
    const load = async () => {
      setProofUrl(null);
      const detail = detailQuery.data as PaymentDetail | undefined;
      const proof = detail?.proofs[0];
      if (!proof) return;
      try {
        const blob = await api.fetchProofBlob(proof.id);
        const url = URL.createObjectURL(blob);
        revoke = url;
        setProofUrl(url);
      } catch {
        setProofUrl(null);
      }
    };
    void load();
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [detailQuery.data, api]);

  const recordMutation = useMutation({
    mutationFn: () =>
      api.recordGCash({
        subscriberId,
        amount,
        referenceNumber,
        senderName,
        idempotencyKey: crypto.randomUUID(),
        proof: proofFile!,
      }),
    onSuccess: async (payment) => {
      setError(null);
      setAmount("");
      setReferenceNumber("");
      setSenderName("");
      setProofFile(null);
      setSubscriberId("");
      setSubscriberLabel("");
      setSelectedId(payment.id);
      await qc.invalidateQueries({ queryKey: ["gcash-pending"] });
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : "Record failed.");
    },
  });

  const verifyMutation = useMutation({
    mutationFn: () => api.verifyGCash(selectedId!),
    onSuccess: async (result) => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["gcash-pending"] });
      await qc.invalidateQueries({ queryKey: ["payment", selectedId] });
      if (result.receipt?.id) {
        navigate(`/payments/receipts/${result.receipt.id}`);
      }
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : "Verify failed.");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => api.rejectGCash(selectedId!, rejectReason),
    onSuccess: async () => {
      setError(null);
      setRejectReason("");
      setSelectedId(null);
      await qc.invalidateQueries({ queryKey: ["gcash-pending"] });
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : "Reject failed.");
    },
  });

  if (!can("gcash.verify") && !can("payment.create")) {
    return (
      <p className="text-sm text-muted">You do not have access to GCash verification.</p>
    );
  }

  const selected = detailQuery.data;
  const queue = queueQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">GCash Verification</h1>
        <p className="mt-1 text-sm text-muted">
          Record proofs as PENDING only. Nothing posts until an authorized user verifies.
        </p>
      </div>

      {can("payment.create") ? (
        <div className="space-y-3 border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">Record GCash proof</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <label className="text-sm font-medium">Subscriber</label>
              <AsyncCombobox
                value={subscriberId}
                selectedLabel={subscriberLabel}
                loadOptions={loadSubscribers}
                placeholder="Search account or name"
                onChange={(v, opt) => {
                  setSubscriberId(v);
                  setSubscriberLabel(opt?.label ?? "");
                }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="gcash-amount">
                Amount
              </label>
              <Input
                id="gcash-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="gcash-ref">
                Reference no.
              </label>
              <Input
                id="gcash-ref"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="gcash-sender">
                Sender name
              </label>
              <Input
                id="gcash-sender"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="gcash-proof">
                Proof (JPG/PNG/PDF)
              </label>
              <Input
                id="gcash-proof"
                type="file"
                accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <Button
            type="button"
            disabled={
              !subscriberId ||
              !amount ||
              !referenceNumber ||
              !senderName ||
              !proofFile ||
              recordMutation.isPending
            }
            onClick={() => recordMutation.mutate()}
          >
            Save as PENDING
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="border border-border bg-surface">
          <div className="border-b border-border px-3 py-2 text-sm font-semibold text-ink">
            Pending queue
          </div>
          <ul className="max-h-[28rem] overflow-auto">
            {queue.length === 0 ? (
              <li className="px-3 py-4 text-sm text-muted">No pending GCash proofs.</li>
            ) : (
              queue.map((p: PaymentListItem) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-canvas ${
                      selectedId === p.id ? "bg-canvas" : ""
                    }`}
                    onClick={() => {
                      setSelectedId(p.id);
                      setRejectReason("");
                      setError(null);
                    }}
                  >
                    <span className="font-medium text-ink">
                      {p.referenceNumber} — {formatCentavos(BigInt(p.amountCentavos))}
                    </span>
                    <span className="text-muted">
                      {p.subscriberAccountNumber} · {p.senderName ?? "—"}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="border border-border bg-surface p-4">
          {!selected ? (
            <p className="text-sm text-muted">Select a pending item to preview proof.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm text-muted">Reference</p>
                  <p className="font-medium text-ink">{selected.referenceNumber}</p>
                </div>
                <StatusBadge status={selected.status} />
              </div>
              <p className="text-sm">
                <Link
                  to={`/subscribers/${selected.subscriberId}`}
                  className="text-burgundy hover:underline"
                >
                  {selected.subscriberAccountNumber}
                </Link>{" "}
                — {selected.subscriberName}
              </p>
              <p className="text-sm tabular-nums">
                Amount: {formatCentavos(BigInt(selected.amountCentavos))}
              </p>
              <p className="text-sm text-muted">Sender: {selected.senderName ?? "—"}</p>

              <div className="border border-border bg-canvas p-2">
                {proofUrl && selected.proofs[0]?.mimeType.startsWith("image/") ? (
                  <img
                    src={proofUrl}
                    alt="GCash proof"
                    className="max-h-80 w-full object-contain"
                  />
                ) : proofUrl ? (
                  <a
                    href={proofUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-burgundy hover:underline"
                  >
                    Open proof PDF
                  </a>
                ) : (
                  <p className="text-sm text-muted">Loading proof…</p>
                )}
              </div>

              {selected.status === "PENDING" && can("gcash.verify") ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={verifyMutation.isPending}
                    onClick={() => verifyMutation.mutate()}
                  >
                    Verify &amp; post
                  </Button>
                  {can("gcash.reject") ? (
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      <Input
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Rejection reason"
                        className="min-w-[12rem] flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!rejectReason.trim() || rejectMutation.isPending}
                        onClick={() => rejectMutation.mutate()}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
