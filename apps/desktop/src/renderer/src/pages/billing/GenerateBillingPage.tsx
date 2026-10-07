import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { BillingPreview } from "@bcis/shared";
import { formatCentavos } from "@bcis/shared";
import {
  AsyncCombobox,
  type AsyncComboboxOption,
} from "@/components/async-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";

function defaultPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function GenerateBillingPage() {
  const { api, can } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [period, setPeriod] = useState(defaultPeriod());
  const [areaId, setAreaId] = useState("");
  const [areaLabel, setAreaLabel] = useState("");
  const [preview, setPreview] = useState<BillingPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAreas = useCallback(
    async (search: string): Promise<AsyncComboboxOption[]> => {
      const items = await api.areaOptions(search || undefined);
      return items.map((a) => ({
        value: a.id,
        label: `${a.code} — ${a.name}`,
      }));
    },
    [api],
  );

  const filteredAccounts = useMemo(() => {
    if (!preview) return [];
    if (!areaId) return preview.accounts;
    return preview.accounts.filter((a) => a.collectionAreaId === areaId);
  }, [preview, areaId]);

  const filteredEligible = useMemo(
    () => filteredAccounts.filter((a) => !a.alreadyBilled).length,
    [filteredAccounts],
  );

  const previewMutation = useMutation({
    mutationFn: () => api.previewBilling(period),
    onSuccess: (data) => {
      setPreview(data);
      setError(null);
    },
    onError: (err) => {
      setPreview(null);
      setError(
        err instanceof ApiClientError ? err.message : "Preview failed.",
      );
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => api.generateBilling(period),
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ["billing-current"] });
      await qc.invalidateQueries({ queryKey: ["invoices"] });
      navigate(`/billing/invoices?billingPeriod=${period}`, {
        state: { message: `Generated ${result.createdCount} invoice(s).` },
      });
    },
    onError: (err) => {
      setError(
        err instanceof ApiClientError ? err.message : "Generation failed.",
      );
    },
  });

  if (!can("billing.generate")) {
    return <p className="text-sm text-muted">You do not have access to billing.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted">
          <Link to="/billing" className="text-burgundy hover:underline">
            Current Billing
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Generate Billing</h1>
        <p className="mt-1 text-sm text-muted">
          Preview eligible accounts, then confirm to post invoices and ledger entries.
        </p>
      </div>

      <div className="flex max-w-xl flex-col gap-4 sm:flex-row">
        <div className="flex flex-1 flex-col gap-2">
          <label className="text-sm font-medium text-ink" htmlFor="period">
            Billing period (YYYY-MM)
          </label>
          <Input
            id="period"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value);
              setPreview(null);
            }}
            placeholder="2025-10"
          />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <label className="text-sm font-medium text-ink">
            Area filter (optional)
          </label>
          <AsyncCombobox
            value={areaId}
            selectedLabel={areaLabel}
            loadOptions={loadAreas}
            placeholder="Filter by area…"
            onChange={(v, opt) => {
              setAreaId(v);
              setAreaLabel(opt?.label ?? "");
            }}
          />
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={previewMutation.isPending}
          onClick={() => previewMutation.mutate()}
        >
          Preview
        </Button>
        <Button
          type="button"
          disabled={
            !preview ||
            preview.eligibleCount === 0 ||
            Boolean(areaId) ||
            generateMutation.isPending
          }
          onClick={() => generateMutation.mutate()}
        >
          Confirm generate
        </Button>
        {areaId ? (
          <p className="text-sm text-muted">
            Clear the area filter to confirm — generation bills all eligible accounts for the period.
          </p>
        ) : null}
      </div>

      {preview ? (
        <div className="space-y-4">
          <dl className="grid max-w-lg gap-3 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-muted">Eligible (new){areaId ? " in area" : ""}</dt>
              <dd className="font-medium">{filteredEligible}</dd>
            </div>
            <div>
              <dt className="text-muted">Estimated total (all)</dt>
              <dd className="font-medium tabular-nums">
                {formatCentavos(BigInt(preview.estimatedTotalCentavos))}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Due date (sample)</dt>
              <dd className="font-medium">{preview.dueDate}</dd>
            </div>
          </dl>

          <div className="overflow-auto rounded-md border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-surface">
                <tr className="border-b border-border text-left text-muted">
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Subscriber</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-muted">
                      No results
                    </td>
                  </tr>
                ) : (
                  filteredAccounts.map((a) => (
                    <tr key={a.serviceAccountId} className="border-b border-border">
                      <td className="px-3 py-2 font-mono">{a.accountNumber}</td>
                      <td className="px-3 py-2">{a.subscriberName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCentavos(BigInt(a.rateCentavos))}
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {a.alreadyBilled ? "Already billed" : "Will bill"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
