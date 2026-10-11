import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useNavigate } from "react-router-dom";
import {
  DELINQUENCY_AGE_BUCKETS,
  formatCentavos,
  SERVICE_TYPE_CODES,
} from "@bcis/shared";
import { AsyncCombobox, type AsyncComboboxOption } from "@/components/async-combobox";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { TabEmptyState } from "@/components/tab-empty-state";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiClientError, type OverdueReceivableItem } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function Money({ value }: { value: string }) {
  return (
    <span className="block text-right tabular-nums">
      {formatCentavos(BigInt(value))}
    </span>
  );
}

export function OverduePage() {
  const { api, can } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [areaId, setAreaId] = useState("");
  const [areaLabel, setAreaLabel] = useState("");
  const [collectorId, setCollectorId] = useState("");
  const [collectorLabel, setCollectorLabel] = useState("");
  const [planId, setPlanId] = useState("");
  const [planLabel, setPlanLabel] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [bucket, setBucket] = useState("");
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const filters = {
    page,
    pageSize,
    collectionAreaId: areaId || undefined,
    collectorUserId: collectorId || undefined,
    servicePlanId: planId || undefined,
    serviceTypeCode: serviceType || undefined,
    delinquencyAgeBucket: bucket || undefined,
  };

  const q = useQuery({
    queryKey: ["receivables-overdue", filters],
    queryFn: () => api.listOverdueReceivables(filters),
    enabled: can("receivable.view"),
  });

  const loadAreas = useCallback(
    async (search: string): Promise<AsyncComboboxOption[]> =>
      (await api.areaOptions(search || undefined)).map((item) => ({
        value: item.id,
        label: `${item.code} — ${item.name}`,
      })),
    [api],
  );
  const loadCollectors = useCallback(
    async (search: string): Promise<AsyncComboboxOption[]> =>
      (await api.collectorOptions(search || undefined)).map((item) => ({
        value: item.id,
        label: `${item.fullName} (${item.username})`,
      })),
    [api],
  );
  const loadPlans = useCallback(
    async (search: string): Promise<AsyncComboboxOption[]> =>
      (await api.planOptions(search || undefined)).map((item) => ({
        value: item.id,
        label: `${item.code} — ${item.name}`,
      })),
    [api],
  );

  async function doExport(format: "pdf" | "xlsx") {
    setExportError(null);
    setExporting(format);
    try {
      await api.downloadReportExport("/receivables/overdue/export", {
        format,
        collectionAreaId: areaId || undefined,
        collectorUserId: collectorId || undefined,
        servicePlanId: planId || undefined,
        serviceTypeCode: serviceType || undefined,
        delinquencyAgeBucket: bucket || undefined,
        page: 1,
        pageSize: 100,
      });
    } catch (err) {
      setExportError(
        err instanceof ApiClientError ? err.message : "Cannot reach the server",
      );
    } finally {
      setExporting(null);
    }
  }

  const columns = useMemo<ColumnDef<OverdueReceivableItem>[]>(
    () => [
      { accessorKey: "subscriberName", header: "Subscriber" },
      { accessorKey: "serviceName", header: "Service" },
      {
        accessorKey: "collectionAreaName",
        header: "Area",
        cell: ({ row }) => row.original.collectionAreaName ?? "—",
      },
      {
        accessorKey: "collectorName",
        header: "Collector",
        cell: ({ row }) => row.original.collectorName ?? "—",
      },
      {
        accessorKey: "monthsUnpaid",
        header: "Months unpaid",
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {row.original.monthsUnpaid}
          </span>
        ),
      },
      { accessorKey: "oldestUnpaidInvoice", header: "Oldest unpaid invoice" },
      {
        accessorKey: "lastPaymentDate",
        header: "Last payment",
        cell: ({ row }) => row.original.lastPaymentDate ?? "—",
      },
      {
        accessorKey: "totalArrearsCentavos",
        header: "Total arrears",
        cell: ({ row }) => <Money value={row.original.totalArrearsCentavos} />,
      },
      {
        accessorKey: "delinquencyAgeBucket",
        header: "Age",
        cell: ({ row }) => (
          <StatusBadge status={row.original.delinquencyAgeBucket} />
        ),
      },
    ],
    [],
  );

  if (!can("receivable.view")) {
    return <p className="text-sm text-muted">No access to receivables.</p>;
  }

  const totalPages = Math.max(1, Math.ceil((q.data?.total ?? 0) / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Overdue</h1>
          <p className="mt-1 text-sm text-muted">
            Overdue service accounts for follow-up. Click a row to open the
            subscriber profile.
          </p>
        </div>
        {can("report.export") ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={exporting !== null}
              onClick={() => void doExport("pdf")}
            >
              {exporting === "pdf" ? "Exporting…" : "Export PDF"}
            </Button>
            <Button
              type="button"
              disabled={exporting !== null}
              onClick={() => void doExport("xlsx")}
            >
              {exporting === "xlsx" ? "Exporting…" : "Export XLSX"}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface p-4">
        <div className="w-56 space-y-1">
          <Label>Collector</Label>
          <AsyncCombobox
            value={collectorId}
            selectedLabel={collectorLabel}
            loadOptions={loadCollectors}
            placeholder="All collectors"
            onChange={(v, o) => {
              setCollectorId(v);
              setCollectorLabel(o?.label ?? "");
              setPage(1);
            }}
          />
        </div>
        <div className="w-56 space-y-1">
          <Label>Area</Label>
          <AsyncCombobox
            value={areaId}
            selectedLabel={areaLabel}
            loadOptions={loadAreas}
            placeholder="All areas"
            onChange={(v, o) => {
              setAreaId(v);
              setAreaLabel(o?.label ?? "");
              setPage(1);
            }}
          />
        </div>
        <div className="w-56 space-y-1">
          <Label>Plan</Label>
          <AsyncCombobox
            value={planId}
            selectedLabel={planLabel}
            loadOptions={loadPlans}
            placeholder="All plans"
            onChange={(v, o) => {
              setPlanId(v);
              setPlanLabel(o?.label ?? "");
              setPage(1);
            }}
          />
        </div>
        <div className="w-40 space-y-1">
          <Label>Service type</Label>
          <select
            className="flex h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
            value={serviceType}
            onChange={(e) => {
              setServiceType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All types</option>
            {SERVICE_TYPE_CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
        <div className="w-40 space-y-1">
          <Label>Delinquency age</Label>
          <select
            className="flex h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
            value={bucket}
            onChange={(e) => {
              setBucket(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All buckets</option>
            {DELINQUENCY_AGE_BUCKETS.map((b) => (
              <option key={b} value={b}>
                {b} days
              </option>
            ))}
          </select>
        </div>
      </div>

      {exportError ? <p className="text-sm text-danger">{exportError}</p> : null}
      {q.isError ? (
        <p className="text-sm text-danger">
          {q.error instanceof ApiClientError
            ? q.error.message
            : "Failed to load overdue accounts."}
        </p>
      ) : null}

      {q.isLoading ? (
        <p className="text-sm text-muted">Loading overdue…</p>
      ) : !q.data || q.data.total === 0 ? (
        <TabEmptyState
          title="No overdue accounts"
          description="No service accounts match these overdue filters."
        />
      ) : (
        <>
          <div
            className="[&_tbody_tr]:cursor-pointer [&_tbody_tr:hover]:bg-canvas"
            onClick={(e) => {
              const tr = (e.target as HTMLElement).closest("tr");
              if (!tr || !tr.parentElement || tr.parentElement.tagName !== "TBODY") {
                return;
              }
              const rows = Array.from(tr.parentElement.children);
              const idx = rows.indexOf(tr);
              const item = q.data?.items[idx];
              if (item) navigate(`/subscribers/${item.subscriberId}`);
            }}
          >
            <DataTable
              columns={columns}
              data={q.data.items}
              pageSize={pageSize}
              searchPlaceholder="Filter loaded page…"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="font-medium text-ink">
              Total arrears:{" "}
              <span className="tabular-nums">
                {formatCentavos(BigInt(q.data.totals.arrearsCentavos))}
              </span>
            </p>
            <div className="flex items-center gap-2 text-muted">
              <span>
                Page {page} of {totalPages} · {q.data.total} accounts
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
