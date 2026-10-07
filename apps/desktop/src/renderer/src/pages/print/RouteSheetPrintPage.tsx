import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { formatCentavos } from "@bcis/shared";
import { AsyncCombobox, type AsyncComboboxOption } from "@/components/async-combobox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";

export function RouteSheetPrintPage() {
  const { api, can } = useAuth();
  const [areaId, setAreaId] = useState("");
  const [areaLabel, setAreaLabel] = useState("");

  const q = useQuery({
    queryKey: ["route-sheet", areaId],
    queryFn: () => api.getRouteSheet({ collectionAreaId: areaId }),
    enabled: Boolean(areaId) && can("report.view"),
  });

  const loadAreas = async (search: string): Promise<AsyncComboboxOption[]> => {
    const items = await api.areaOptions(search || undefined);
    return items.map((a) => ({
      value: a.id,
      label: `${a.code} — ${a.name}`,
    }));
  };

  if (!can("report.view")) {
    return <p className="p-6 text-sm text-muted">No access.</p>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="space-y-3">
          <Link to="/reports" className="text-sm text-burgundy hover:underline">
            ← Reports
          </Link>
          <div className="min-w-[280px]">
            <Label>Collection area</Label>
            <div className="mt-1">
              <AsyncCombobox
                value={areaId}
                selectedLabel={areaLabel}
                loadOptions={loadAreas}
                placeholder="Search area"
                onChange={(v, opt) => {
                  setAreaId(v);
                  setAreaLabel(opt?.label ?? "");
                }}
              />
            </div>
          </div>
        </div>
        <Button
          type="button"
          disabled={!q.data}
          onClick={() => window.print()}
        >
          Print route sheet
        </Button>
      </div>

      {q.isError ? (
        <p className="text-sm text-danger print:hidden">
          {q.error instanceof ApiClientError
            ? q.error.message
            : "Cannot reach the server"}
        </p>
      ) : null}

      {!areaId ? (
        <p className="text-sm text-muted print:hidden">
          Select a collection area to generate the route sheet.
        </p>
      ) : null}

      {q.isLoading ? (
        <p className="text-sm text-muted print:hidden">Loading…</p>
      ) : null}

      {q.data ? (
        <article className="border border-border bg-surface p-8 print:border-0">
          <header className="mb-6 border-b border-border pb-4 text-center">
            <p className="text-xs uppercase tracking-wide text-muted">
              Bukidnon Cable and Internet Services
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-ink">
              Collection Route Sheet
            </h1>
            <p className="mt-2 text-sm text-ink">
              {q.data.areaCode} — {q.data.areaName}
            </p>
            <p className="mt-1 text-sm text-muted">
              Generated {new Date(q.data.generatedAt).toLocaleString("en-PH")}
            </p>
          </header>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-1 font-medium">Account</th>
                <th className="py-1 font-medium">Name</th>
                <th className="py-1 font-medium">Address</th>
                <th className="py-1 text-right font-medium">Current</th>
                <th className="py-1 text-right font-medium">Arrears</th>
                <th className="py-1 text-right font-medium">Total due</th>
              </tr>
            </thead>
            <tbody>
              {q.data.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-muted">
                    No active subscribers in this area.
                  </td>
                </tr>
              ) : (
                q.data.rows.map((r) => (
                  <tr key={r.accountNumber} className="border-b border-border">
                    <td className="py-1">{r.accountNumber}</td>
                    <td className="py-1">{r.fullName}</td>
                    <td className="py-1">{r.address}</td>
                    <td className="py-1 text-right tabular-nums">
                      {formatCentavos(BigInt(r.currentBillCentavos))}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {formatCentavos(BigInt(r.arrearsCentavos))}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {formatCentavos(BigInt(r.totalDueCentavos))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="font-medium">
                <td className="py-2" colSpan={3}>
                  Totals
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatCentavos(BigInt(q.data.totals.currentBillCentavos))}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatCentavos(BigInt(q.data.totals.arrearsCentavos))}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatCentavos(BigInt(q.data.totals.totalDueCentavos))}
                </td>
              </tr>
            </tfoot>
          </table>
        </article>
      ) : null}
    </div>
  );
}
