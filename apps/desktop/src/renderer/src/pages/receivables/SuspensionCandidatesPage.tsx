import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { centavosToString, formatCentavos, pesosToCentavos } from "@bcis/shared";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ApiClientError,
  type SuspendedAccountItem,
  type SuspensionCandidateItem,
  type SuspensionHistoryItem,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";

function Money({ value }: { value: string }) {
  return (
    <span className="block text-right tabular-nums">
      {formatCentavos(BigInt(value))}
    </span>
  );
}

function todayLocal(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SuspensionCandidatesPage() {
  const { api, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [suspendTarget, setSuspendTarget] =
    useState<SuspensionCandidateItem | null>(null);
  const [reason, setReason] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(todayLocal());
  const [approverId, setApproverId] = useState("");
  const [approverLabel, setApproverLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const [reconnectTarget, setReconnectTarget] =
    useState<SuspendedAccountItem | null>(null);
  const [feePesos, setFeePesos] = useState("");
  const [technicianId, setTechnicianId] = useState("");
  const [technicianLabel, setTechnicianLabel] = useState("");
  const [requestDate, setRequestDate] = useState(todayLocal());

  const candidates = useQuery({
    queryKey: ["suspension-candidates", page, pageSize],
    queryFn: () =>
      api.listSuspensionCandidates({ page, pageSize }),
    enabled: can("receivable.view"),
  });

  const suspended = useQuery({
    queryKey: ["suspended-accounts"],
    queryFn: () => api.listSuspendedAccounts({ page: 1, pageSize: 100 }),
    enabled: can("receivable.view"),
  });

  const history = useQuery({
    queryKey: ["suspension-history"],
    queryFn: () => api.listSuspensionHistory({ page: 1, pageSize: 50 }),
    enabled: can("receivable.view"),
  });

  const loadApprovers = useCallback(
    async (search: string): Promise<AsyncComboboxOption[]> =>
      (await api.approverOptions(search || undefined)).map((item) => ({
        value: item.id,
        label: `${item.fullName} (${item.username})`,
      })),
    [api],
  );
  const loadTechnicians = useCallback(
    async (search: string): Promise<AsyncComboboxOption[]> =>
      (await api.technicianOptions(search || undefined)).map((item) => ({
        value: item.id,
        label: `${item.fullName} (${item.username})`,
      })),
    [api],
  );

  async function invalidateAll() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["suspension-candidates"] }),
      qc.invalidateQueries({ queryKey: ["suspended-accounts"] }),
      qc.invalidateQueries({ queryKey: ["suspension-history"] }),
    ]);
  }

  const suspendMut = useMutation({
    mutationFn: () =>
      api.createSuspension({
        serviceAccountId: suspendTarget!.serviceAccountId,
        reason: reason.trim(),
        effectiveDate,
        approvedBy: approverId || null,
        notes: notes.trim() || null,
      }),
    onSuccess: async () => {
      setSuspendTarget(null);
      setFormError(null);
      setReason("");
      setNotes("");
      toast.success("Service account suspended.");
      await invalidateAll();
    },
    onError: (err) =>
      setFormError(
        err instanceof ApiClientError ? err.message : "Could not suspend.",
      ),
  });

  const reconnectMut = useMutation({
    mutationFn: () => {
      let feeCentavos: string | undefined;
      if (feePesos.trim()) {
        feeCentavos = centavosToString(pesosToCentavos(feePesos.trim()));
      }
      return api.createReconnection({
        serviceAccountId: reconnectTarget!.serviceAccountId,
        suspensionId: reconnectTarget!.latestSuspensionId,
        feeCentavos,
        technicianUserId: technicianId || null,
        requestDate,
        notes: notes.trim() || null,
      });
    },
    onSuccess: async () => {
      setReconnectTarget(null);
      setFormError(null);
      setFeePesos("");
      setTechnicianId("");
      setTechnicianLabel("");
      setNotes("");
      toast.success("Reconnection requested.");
      await invalidateAll();
    },
    onError: (err) =>
      setFormError(
        err instanceof ApiClientError
          ? err.message
          : "Could not start reconnection.",
      ),
  });

  const completeMut = useMutation({
    mutationFn: (id: string) => api.completeReconnection(id),
    onSuccess: async () => {
      toast.success("Reconnection completed.");
      await invalidateAll();
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : "Could not complete reconnection.",
      ),
  });

  const candidateColumns = useMemo<ColumnDef<SuspensionCandidateItem>[]>(
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
        accessorKey: "daysPastDue",
        header: "Days past due",
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {row.original.daysPastDue}
          </span>
        ),
      },
      {
        accessorKey: "totalArrearsCentavos",
        header: "Total arrears",
        cell: ({ row }) => <Money value={row.original.totalArrearsCentavos} />,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) =>
          can("service.manage") ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setFormError(null);
                setReason("");
                setNotes("");
                setEffectiveDate(todayLocal());
                setApproverId("");
                setApproverLabel("");
                setSuspendTarget(row.original);
              }}
            >
              Suspend
            </Button>
          ) : (
            "—"
          ),
      },
    ],
    [can],
  );

  const suspendedColumns = useMemo<ColumnDef<SuspendedAccountItem>[]>(
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
        accessorKey: "suspensionReason",
        header: "Reason",
        cell: ({ row }) => row.original.suspensionReason ?? "—",
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          if (!can("service.manage")) return "—";
          if (row.original.pendingReconnectionId) {
            return (
              <Button
                type="button"
                size="sm"
                onClick={() =>
                  completeMut.mutate(row.original.pendingReconnectionId!)
                }
                disabled={completeMut.isPending}
              >
                Complete reconnection
              </Button>
            );
          }
          return (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setFormError(null);
                setFeePesos("");
                setTechnicianId("");
                setTechnicianLabel("");
                setNotes("");
                setRequestDate(todayLocal());
                setReconnectTarget(row.original);
              }}
            >
              Start reconnection
            </Button>
          );
        },
      },
    ],
    [can, completeMut],
  );

  const historyColumns = useMemo<ColumnDef<SuspensionHistoryItem>[]>(
    () => [
      {
        accessorKey: "kind",
        header: "Type",
        cell: ({ row }) => <StatusBadge status={row.original.kind} />,
      },
      { accessorKey: "accountNumber", header: "Account" },
      { accessorKey: "subscriberName", header: "Subscriber" },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "reason",
        header: "Reason / notes",
        cell: ({ row }) => row.original.reason || row.original.notes || "—",
      },
      {
        accessorKey: "createdAt",
        header: "When",
        cell: ({ row }) =>
          new Date(row.original.createdAt).toLocaleString("en-PH"),
      },
    ],
    [],
  );

  if (!can("receivable.view")) {
    return <p className="text-sm text-muted">No access to receivables.</p>;
  }

  const totalPages = Math.max(
    1,
    Math.ceil((candidates.data?.total ?? 0) / pageSize),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-ink">
          Suspension Candidates
        </h1>
        <p className="mt-1 text-sm text-muted">
          Active accounts whose arrears exceed the configured suspension
          threshold
          {candidates.data
            ? ` (${formatCentavos(BigInt(candidates.data.thresholdCentavos))})`
            : ""}
          . Suspensions and reconnections write service history.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-ink">Candidates</h2>
        {candidates.isError ? (
          <p className="text-sm text-danger">
            {candidates.error instanceof ApiClientError
              ? candidates.error.message
              : "Failed to load candidates."}
          </p>
        ) : null}
        {candidates.isLoading ? (
          <p className="text-sm text-muted">Loading candidates…</p>
        ) : !candidates.data || candidates.data.total === 0 ? (
          <TabEmptyState
            title="No suspension candidates"
            description="No active service accounts currently exceed the suspension threshold."
          />
        ) : (
          <>
            <DataTable
              columns={candidateColumns}
              data={candidates.data.items}
              pageSize={pageSize}
              searchPlaceholder="Filter loaded page…"
            />
            <div className="flex items-center justify-end gap-2 text-sm text-muted">
              <span>
                Page {page} of {totalPages}
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
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-ink">Suspended accounts</h2>
        {suspended.isLoading ? (
          <p className="text-sm text-muted">Loading suspended…</p>
        ) : !suspended.data || suspended.data.total === 0 ? (
          <TabEmptyState
            title="No suspended accounts"
            description="Suspended service accounts appear here for reconnection."
          />
        ) : (
          <DataTable
            columns={suspendedColumns}
            data={suspended.data.items}
            pageSize={100}
            searchPlaceholder="Filter suspended…"
          />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-ink">
          Suspension / reconnection history
        </h2>
        {history.isLoading ? (
          <p className="text-sm text-muted">Loading history…</p>
        ) : !history.data || history.data.total === 0 ? (
          <TabEmptyState
            title="No history yet"
            description="Suspension and reconnection records will appear here."
          />
        ) : (
          <DataTable
            columns={historyColumns}
            data={history.data.items}
            pageSize={50}
            searchPlaceholder="Filter history…"
          />
        )}
      </section>

      <Dialog
        open={Boolean(suspendTarget)}
        onOpenChange={(open) => {
          if (!open) setSuspendTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend service account</DialogTitle>
          </DialogHeader>
          {suspendTarget ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                {suspendTarget.accountNumber} — {suspendTarget.subscriberName}
              </p>
              <div className="space-y-1">
                <Label>Reason</Label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Effective date</Label>
                <Input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Approver</Label>
                <AsyncCombobox
                  value={approverId}
                  selectedLabel={approverLabel}
                  loadOptions={loadApprovers}
                  placeholder="Select approver…"
                  onChange={(v, o) => {
                    setApproverId(v);
                    setApproverLabel(o?.label ?? "");
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              {formError ? (
                <p className="text-sm text-danger">{formError}</p>
              ) : null}
              <Button
                type="button"
                disabled={!reason.trim() || suspendMut.isPending}
                onClick={() => suspendMut.mutate()}
              >
                {suspendMut.isPending ? "Saving…" : "Confirm suspension"}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(reconnectTarget)}
        onOpenChange={(open) => {
          if (!open) setReconnectTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start reconnection</DialogTitle>
          </DialogHeader>
          {reconnectTarget ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                {reconnectTarget.accountNumber} —{" "}
                {reconnectTarget.subscriberName}
              </p>
              <div className="space-y-1">
                <Label>Fee (optional, pesos)</Label>
                <Input
                  value={feePesos}
                  onChange={(e) => setFeePesos(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1">
                <Label>Technician</Label>
                <AsyncCombobox
                  value={technicianId}
                  selectedLabel={technicianLabel}
                  loadOptions={loadTechnicians}
                  placeholder="Select technician…"
                  onChange={(v, o) => {
                    setTechnicianId(v);
                    setTechnicianLabel(o?.label ?? "");
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label>Request date</Label>
                <Input
                  type="date"
                  value={requestDate}
                  onChange={(e) => setRequestDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              {formError ? (
                <p className="text-sm text-danger">{formError}</p>
              ) : null}
              <Button
                type="button"
                disabled={reconnectMut.isPending}
                onClick={() => reconnectMut.mutate()}
              >
                {reconnectMut.isPending ? "Saving…" : "Start reconnection"}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
