import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { formatCentavos } from "@bcis/shared";
import { AsyncCombobox, type AsyncComboboxOption } from "@/components/async-combobox";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { TabEmptyState } from "@/components/tab-empty-state";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ApiClientError, type CollectionBatchItem, type CollectionBatchStatus } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const STATUSES: CollectionBatchStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "SUBMITTED",
  "REMITTED",
  "RECONCILED",
  "CLOSED",
];

function Money({ value }: { value: string }) {
  return (
    <span className="block text-right tabular-nums">
      {formatCentavos(BigInt(value))}
    </span>
  );
}

export function BatchesPage() {
  const { api, can } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const [status, setStatus] = useState<CollectionBatchStatus | "">("");
  const [collectorId, setCollectorId] = useState(
    () => searchParams.get("collectorUserId") ?? "",
  );
  const [collectorLabel, setCollectorLabel] = useState("");
  const [areaId, setAreaId] = useState("");
  const [areaLabel, setAreaLabel] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newCollectorId, setNewCollectorId] = useState("");
  const [newCollectorLabel, setNewCollectorLabel] = useState("");
  const [newAreaId, setNewAreaId] = useState("");
  const [newAreaLabel, setNewAreaLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const batches = useQuery({
    queryKey: ["collection-batches", status, collectorId, areaId],
    queryFn: () =>
      api.listCollectionBatches({
        page: 1,
        pageSize: 100,
        status: status || undefined,
        collectorUserId: collectorId || undefined,
        collectionAreaId: areaId || undefined,
      }),
  });

  const route = useQuery({
    queryKey: ["new-batch-route", newAreaId, newCollectorId],
    queryFn: () =>
      api.getRouteSheet({
        collectionAreaId: newAreaId,
        collectorUserId: newCollectorId,
      }),
    enabled: newOpen && Boolean(newAreaId && newCollectorId),
  });

  const create = useMutation({
    mutationFn: () =>
      api.createCollectionBatch({
        collectorUserId: newCollectorId,
        collectionAreaId: newAreaId,
        accounts: (route.data?.rows ?? []).map((row) => ({
          subscriberId: row.subscriberId,
          expectedCentavos: row.totalDueCentavos,
        })),
      }),
    onSuccess: async (batch) => {
      setNewOpen(false);
      setError(null);
      await qc.invalidateQueries({ queryKey: ["collection-batches"] });
      toast.success("Collection batch created.");
      navigate(`/collections/batches/${batch.id}`);
    },
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : "Could not create batch."),
  });

  const loadCollectors = useCallback(
    async (search: string): Promise<AsyncComboboxOption[]> =>
      (await api.collectorOptions(search || undefined)).map((item) => ({
        value: item.id,
        label: `${item.fullName} (${item.username})`,
      })),
    [api],
  );
  const loadAreas = useCallback(
    async (search: string): Promise<AsyncComboboxOption[]> =>
      (await api.areaOptions(search || undefined)).map((item) => ({
        value: item.id,
        label: `${item.code} — ${item.name}`,
      })),
    [api],
  );

  const columns = useMemo<ColumnDef<CollectionBatchItem>[]>(
    () => [
      {
        accessorKey: "batchNumber",
        header: "Batch no.",
        cell: ({ row }) => (
          <Link
            to={`/collections/batches/${row.original.id}`}
            className="font-medium text-burgundy hover:underline"
          >
            {row.original.batchNumber}
          </Link>
        ),
      },
      { accessorKey: "collectorName", header: "Collector" },
      { accessorKey: "collectionAreaName", header: "Area" },
      {
        accessorKey: "createdAt",
        header: "Date",
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString("en-PH"),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "expectedCashCentavos",
        header: "Expected",
        cell: ({ row }) => <Money value={row.original.expectedCashCentavos} />,
      },
      {
        id: "collected",
        header: "Collected",
        cell: ({ row }) => (
          <Money
            value={(
              BigInt(row.original.collectedCashCentavos) +
              BigInt(row.original.collectedNonCashCentavos)
            ).toString()}
          />
        ),
      },
      {
        accessorKey: "accountCount",
        header: "Accounts",
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">{row.original.accountCount}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Collection Batches</h1>
          <p className="mt-1 text-sm text-muted">
            Prepare routes, record field collections, and track batch status.
          </p>
        </div>
        {can("collection.create") ? (
          <Dialog open={newOpen} onOpenChange={setNewOpen}>
            <DialogTrigger asChild>
              <Button type="button">New batch</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New collection batch</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Collector</Label>
                  <AsyncCombobox
                    value={newCollectorId}
                    selectedLabel={newCollectorLabel}
                    loadOptions={loadCollectors}
                    placeholder="Search collector…"
                    onChange={(value, option) => {
                      setNewCollectorId(value);
                      setNewCollectorLabel(option?.label ?? "");
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Collection area</Label>
                  <AsyncCombobox
                    value={newAreaId}
                    selectedLabel={newAreaLabel}
                    loadOptions={loadAreas}
                    placeholder="Search area…"
                    onChange={(value, option) => {
                      setNewAreaId(value);
                      setNewAreaLabel(option?.label ?? "");
                    }}
                  />
                </div>
                {route.isLoading ? <p className="text-sm text-muted">Loading route…</p> : null}
                {route.data ? (
                  <div className="border border-border bg-canvas p-3 text-sm">
                    <p>{route.data.rows.length} account(s) on this route</p>
                    <p className="mt-1 tabular-nums text-muted">
                      Expected: {formatCentavos(BigInt(route.data.totals.totalDueCentavos))}
                    </p>
                  </div>
                ) : null}
                {route.isError || error ? (
                  <p className="text-sm text-danger">
                    {error ??
                      (route.error instanceof ApiClientError
                        ? route.error.message
                        : "Could not load route.")}
                  </p>
                ) : null}
                <Button
                  type="button"
                  disabled={!route.data || route.data.rows.length === 0 || create.isPending}
                  onClick={() => create.mutate()}
                >
                  {create.isPending ? "Creating…" : "Create batch"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <select
          className="h-10 rounded-md border border-border bg-surface px-3 text-sm"
          value={status}
          onChange={(event) => setStatus(event.target.value as CollectionBatchStatus | "")}
        >
          <option value="">All statuses</option>
          {STATUSES.map((item) => (
            <option key={item} value={item}>{item.replaceAll("_", " ")}</option>
          ))}
        </select>
        <AsyncCombobox
          value={collectorId}
          selectedLabel={collectorLabel}
          loadOptions={loadCollectors}
          placeholder="Filter collector…"
          onChange={(value, option) => {
            setCollectorId(value);
            setCollectorLabel(option?.label ?? "");
          }}
        />
        <AsyncCombobox
          value={areaId}
          selectedLabel={areaLabel}
          loadOptions={loadAreas}
          placeholder="Filter area…"
          onChange={(value, option) => {
            setAreaId(value);
            setAreaLabel(option?.label ?? "");
          }}
        />
      </div>

      {batches.isError ? (
        <p className="text-sm text-danger">
          {batches.error instanceof ApiClientError
            ? batches.error.message
            : "Could not load collection batches."}
        </p>
      ) : batches.data?.items.length === 0 ? (
        <TabEmptyState
          title="No collection batches"
          description="Create a batch or adjust the selected filters."
        />
      ) : (
        <DataTable
          columns={columns}
          data={batches.data?.items ?? []}
          searchPlaceholder="Search batches…"
        />
      )}
    </div>
  );
}
