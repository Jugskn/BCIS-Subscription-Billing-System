import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AllocationPreviewResponse } from "@bcis/shared";
import { formatCentavos } from "@bcis/shared";
import {
  AsyncCombobox,
  type AsyncComboboxOption,
} from "@/components/async-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";

const METHODS = ["Cash", "BankTransfer", "Cheque", "Other"] as const;

export function ReceivePaymentPage() {
  const { api, can } = useAuth();
  const navigate = useNavigate();
  const [subscriberId, setSubscriberId] = useState("");
  const [subscriberLabel, setSubscriberLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof METHODS)[number]>("Cash");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [preview, setPreview] = useState<AllocationPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const balanceQuery = useQuery({
    queryKey: ["open-balance", subscriberId],
    queryFn: () => api.getOpenBalance(subscriberId),
    enabled: Boolean(subscriberId),
  });

  const previewMutation = useMutation({
    mutationFn: () =>
      api.previewPaymentAllocation({
        subscriberId,
        amount,
      }),
    onSuccess: (data) => {
      setPreview(data);
      setError(null);
    },
    onError: (err) => {
      setPreview(null);
      setError(err instanceof ApiClientError ? err.message : "Preview failed.");
    },
  });

  const postMutation = useMutation({
    mutationFn: () =>
      api.postPayment({
        subscriberId,
        amount,
        method,
        referenceNumber: referenceNumber || undefined,
        notes: notes || undefined,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (result) => {
      setError(null);
      const receiptId = result.receipt?.id;
      if (receiptId) {
        navigate(`/payments/receipts/${receiptId}`);
      }
    },
    onError: (err) => {
      setError(err instanceof ApiClientError ? err.message : "Posting failed.");
    },
  });

  if (!can("payment.create")) {
    return (
      <p className="text-sm text-muted">You do not have permission to receive payments.</p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Receive Payment</h1>
        <p className="mt-1 text-sm text-muted">
          Search a subscriber, preview allocation, then post and print the receipt.
        </p>
      </div>

      <div className="max-w-xl space-y-2">
        <label className="text-sm font-medium text-ink" htmlFor="search">
          Search subscriber
        </label>
        <AsyncCombobox
          value={subscriberId}
          selectedLabel={subscriberLabel}
          loadOptions={loadSubscribers}
          placeholder="Account number or name"
          onChange={(v, opt) => {
            setSubscriberId(v);
            setSubscriberLabel(opt?.label ?? "");
            setPreview(null);
          }}
        />
      </div>

      {subscriberId ? (
        <div className="space-y-4 border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-sm text-muted">Subscriber</p>
              <p className="text-lg font-medium text-ink">
                <Link
                  to={`/subscribers/${subscriberId}`}
                  className="text-burgundy hover:underline"
                >
                  {subscriberLabel || subscriberId}
                </Link>
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted">Open balance</p>
              <p className="text-lg tabular-nums text-ink">
                {balanceQuery.isError
                  ? balanceQuery.error instanceof ApiClientError
                    ? balanceQuery.error.message
                    : "Failed to load"
                  : balanceQuery.data
                    ? formatCentavos(BigInt(balanceQuery.data.openBalanceCentavos))
                    : "…"}
              </p>
            </div>
          </div>

          <div className="grid max-w-xl gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink" htmlFor="amount">
                Amount (PHP)
              </label>
              <Input
                id="amount"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setPreview(null);
                }}
                placeholder="0.00"
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-ink" htmlFor="method">
                Method
              </label>
              <select
                id="method"
                className="flex h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
                value={method}
                onChange={(e) =>
                  setMethod(e.target.value as (typeof METHODS)[number])
                }
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-sm font-medium text-ink" htmlFor="ref">
                Reference no. (optional)
              </label>
              <Input
                id="ref"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-sm font-medium text-ink" htmlFor="notes">
                Notes
              </label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!amount || previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
            >
              Preview allocation
            </Button>
            <Button
              type="button"
              disabled={!preview || postMutation.isPending}
              onClick={() => postMutation.mutate()}
            >
              Post payment
            </Button>
            <p className="self-center text-sm text-muted">
              GCash proofs go through{" "}
              <Link to="/payments/gcash" className="text-burgundy hover:underline">
                GCash Verification
              </Link>
              .
            </p>
          </div>

          {preview ? (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-ink">Allocation preview</h2>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    <th className="px-2 py-1 font-medium">Invoice</th>
                    <th className="px-2 py-1 text-right font-medium">Allocate</th>
                    <th className="px-2 py-1 text-right font-medium">Remaining</th>
                    <th className="px-2 py-1 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.allocations.map((a) => (
                    <tr key={a.invoiceId} className="border-b border-border">
                      <td className="px-2 py-1">{a.invoiceNumber}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {formatCentavos(BigInt(a.allocatedCentavos))}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {formatCentavos(BigInt(a.remainingBalanceCentavos))}
                      </td>
                      <td className="px-2 py-1">{a.resultingStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-sm text-muted">
                Unallocated credit:{" "}
                <span className="tabular-nums text-ink">
                  {formatCentavos(BigInt(preview.unallocatedCentavos))}
                </span>
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
