import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { formatCentavos } from "@bcis/shared";
import { AsyncCombobox, type AsyncComboboxOption } from "@/components/async-combobox";
import { DataTable } from "@/components/data-table";
import { TabEmptyState } from "@/components/tab-empty-state";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ApiClientError, type CollectorSummary } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function Money({ value }: { value: string }) {
  return (
    <span className="block text-right tabular-nums">
      {formatCentavos(BigInt(value))}
    </span>
  );
}

export function CollectorsPage() {
  const { api, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [collector, setCollector] = useState<CollectorSummary | null>(null);
  const [areaId, setAreaId] = useState("");
  const [areaLabel, setAreaLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const collectors = useQuery({
    queryKey: ["collector-summaries"],
    queryFn: () => api.listCollectorSummaries({ page: 1, pageSize: 100 }),
  });

  const loadAreas = useCallback(
    async (search: string): Promise<AsyncComboboxOption[]> =>
      (await api.areaOptions(search || undefined)).map((item) => ({
        value: item.id,
        label: `${item.code} — ${item.name}`,
      })),
    [api],
  );

  const assign = useMutation({
    mutationFn: () => api.assignCollectorArea(collector!.collectorUserId, areaId),
    onSuccess: async () => {
      setAreaId("");
      setAreaLabel("");
      setError(null);
      setCollector(null);
      await qc.invalidateQueries({ queryKey: ["collector-summaries"] });
      toast.success("Area assigned.");
    },
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : "Assignment failed."),
  });

  const unassign = useMutation({
    mutationFn: ({
      collectorId,
      collectionAreaId,
    }: {
      collectorId: string;
      collectionAreaId: string;
    }) => api.unassignCollectorArea(collectorId, collectionAreaId),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["collector-summaries"] });
      toast.success("Area unassigned.");
    },
    onError: (err) =>
      setError(err instanceof ApiClientError ? err.message : "Unassign failed."),
  });

  const columns = useMemo<ColumnDef<CollectorSummary>[]>(
    () => [
      {
        accessorKey: "collectorName",
        header: "Collector",
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.collectorName}</p>
            <p className="text-xs text-muted">{row.original.username}</p>
          </div>
        ),
      },
      {
        id: "areas",
        header: "Assigned areas",
        cell: ({ row }) => (
          <div className="space-y-1">
            {row.original.assignedAreas.length === 0 ? (
              <span className="text-muted">None</span>
            ) : (
              row.original.assignedAreas.map((area) => (
                <div key={area.id} className="flex items-center gap-2">
                  <span>{area.code} — {area.name}</span>
                  {can("collection.create") ? (
                    <button
                      type="button"
                      className="text-xs text-danger hover:underline"
                      onClick={() =>
                        unassign.mutate({
                          collectorId: row.original.collectorUserId,
                          collectionAreaId: area.id,
                        })
                      }
                    >
                      Unassign
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        ),
      },
      {
        accessorKey: "subscriberCount",
        header: "Subscribers",
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">{row.original.subscriberCount}</span>
        ),
      },
      {
        accessorKey: "openBatchCount",
        header: "Open batches",
        cell: ({ row }) => (
          <Link
            to={`/collections/batches?collectorUserId=${row.original.collectorUserId}`}
            className="block text-right tabular-nums text-burgundy hover:underline"
          >
            {row.original.openBatchCount}
          </Link>
        ),
      },
      {
        accessorKey: "currentMonthCollectedCentavos",
        header: "Collected this month",
        cell: ({ row }) => <Money value={row.original.currentMonthCollectedCentavos} />,
      },
      {
        accessorKey: "remittanceDifferenceCentavos",
        header: "Remittance difference",
        cell: ({ row }) => <Money value={row.original.remittanceDifferenceCentavos} />,
      },
      ...(can("collection.create")
        ? [
            {
              id: "actions",
              header: "Action",
              cell: ({ row }) => (
                <Button size="sm" variant="outline" onClick={() => setCollector(row.original)}>
                  Assign area
                </Button>
              ),
            } satisfies ColumnDef<CollectorSummary>,
          ]
        : []),
    ],
    [can, unassign],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Collectors</h1>
        <p className="mt-1 text-sm text-muted">
          Area assignments and current collection performance.
        </p>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {collectors.isError ? (
        <p className="text-sm text-danger">
          {collectors.error instanceof ApiClientError
            ? collectors.error.message
            : "Could not load collectors."}
        </p>
      ) : collectors.data?.items.length === 0 ? (
        <TabEmptyState
          title="No collectors"
          description="Assign the Collector role to a user first."
        />
      ) : (
        <DataTable
          columns={columns}
          data={collectors.data?.items ?? []}
          searchPlaceholder="Search collectors…"
        />
      )}

      <Dialog open={collector !== null} onOpenChange={(open) => !open && setCollector(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign area to {collector?.collectorName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Collection area</Label>
              <AsyncCombobox
                value={areaId}
                selectedLabel={areaLabel}
                loadOptions={loadAreas}
                placeholder="Search area…"
                onChange={(value, option) => {
                  setAreaId(value);
                  setAreaLabel(option?.label ?? "");
                }}
              />
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <Button
              type="button"
              disabled={!areaId || assign.isPending}
              onClick={() => assign.mutate()}
            >
              Assign area
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
