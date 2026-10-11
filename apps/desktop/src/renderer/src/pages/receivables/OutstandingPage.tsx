import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { formatCentavos, SERVICE_TYPE_CODES } from "@bcis/shared";
import { AsyncCombobox, type AsyncComboboxOption } from "@/components/async-combobox";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { TabEmptyState } from "@/components/tab-empty-state";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ApiClientError,
  type OutstandingReceivableItem,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";

function Money({ value }: { value: string }) {
  return (
    <span className="block text-right tabular-nums">
      {formatCentavos(BigInt(value))}
    </span>
  );
}

export function OutstandingPage() {
  const { api, can } = useAuth();
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [areaId, setAreaId] = useState("");
  const [areaLabel, setAreaLabel] = useState("");
  const [collectorId, setCollectorId] = useState("");
  const [collectorLabel, setCollectorLabel] = useState("");
  const [planId, setPlanId] = useState("");
  const [planLabel, setPlanLabel] = useState("");
  const [serviceType, setServiceType] = useState("");

  const filters = {
    page,
    pageSize,
    collectionAreaId: areaId || undefined,
    collectorUserId: collectorId || undefined,
    servicePlanId: planId || undefined,
    serviceTypeCode: serviceType || undefined,
  };

  const q = useQuery({
    queryKey: ["receivables-outstanding", filters],
    queryFn: () => api.listOutstandingReceivables(filters),
    enabled: can("receivable.view"),
  });

  const aging = useQuery({
    queryKey: [
      "receivables-aging-footer",
      areaId,
      collectorId,
      planId,
      serviceType,
    ],
    queryFn: () =>
      api.getReceivablesAging({
        collectionAreaId: areaId || undefined,
        collectorUserId: collectorId || undefined,
      }),
    enabled: can("receivable.view") && !planId && !serviceType,
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

  const columns = useMemo<ColumnDef<OutstandingReceivableItem>[]>(
    () => [
      {
        accessorKey: "accountNumber",
        header: "Account no.",
        cell: ({ row }) => (
          <Link
            to={`/subscribers/${row.original.subscriberId}`}
            className="font-medium text-burgundy hover:underline"
          >
            {row.original.accountNumber}
          </Link>
        ),
      },
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
        accessorKey: "currentBalanceCentavos",
        header: "Current balance",
        cell: ({ row }) => (
          <Money value={row.original.currentBalanceCentavos} />
        ),
      },
      { accessorKey: "oldestDueDate", header: "Oldest due date" },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    [],
  );

  if (!can("receivable.view")) {
    return <p className="text-sm text-muted">No access to receivables.</p>;
  }

  const totalPages = Math.max(1, Math.ceil((q.data?.total ?? 0) / pageSize));
  const footerMatchesAging =
    !planId &&
    !serviceType &&
    aging.data &&
    q.data &&
    aging.data.totalBalanceCentavos === q.data.totals.balanceCentavos;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Outstanding Receivables</h1>
        <p className="mt-1 text-sm text-muted">
          Service accounts with an open balance. Footer total matches AR aging
          when area/collector filters align (no plan/type filter).
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface p-4">
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
      </div>

      {q.isError ? (
        <p className="text-sm text-danger">
          {q.error instanceof ApiClientError
            ? q.error.message
            : "Failed to load outstanding receivables."}
        </p>
      ) : null}

      {q.isLoading ? (
        <p className="text-sm text-muted">Loading outstanding…</p>
      ) : !q.data || q.data.total === 0 ? (
        <TabEmptyState
          title="No open balances"
          description="There are no service accounts with an outstanding balance for these filters."
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={q.data.items}
            pageSize={pageSize}
            searchPlaceholder="Filter loaded page…"
          />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="font-medium text-ink">
              Total open balance:{" "}
              <span className="tabular-nums">
                {formatCentavos(BigInt(q.data.totals.balanceCentavos))}
              </span>
              {footerMatchesAging ? (
                <span className="ml-2 text-muted">(matches AR aging)</span>
              ) : null}
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
