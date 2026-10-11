import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import type { BackupListItem } from "@bcis/shared";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/toast";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";

function formatBytes(n: string) {
  const v = Number(n);
  if (!Number.isFinite(v)) return n;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupsPage() {
  const { api, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupListItem | null>(
    null,
  );
  const [confirmText, setConfirmText] = useState("");

  const backupsQuery = useQuery({
    queryKey: ["backups"],
    queryFn: () => api.listBackups(),
  });
  const rootQuery = useQuery({
    queryKey: ["backups-root"],
    queryFn: () => api.getBackupsRoot(),
  });

  const createMutation = useMutation({
    mutationFn: () => api.createBackup(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["backups"] });
      toast.success("Backup created");
      setError(null);
    },
    onError: (err) => {
      setError(
        err instanceof ApiClientError ? err.message : "Cannot reach the server",
      );
    },
  });

  const verifyMutation = useMutation({
    mutationFn: (id: string) => api.verifyBackup(id),
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ["backups"] });
      toast.success(result.verified ? "Verified" : "Verification failed");
    },
    onError: (err) => {
      setError(
        err instanceof ApiClientError ? err.message : "Cannot reach the server",
      );
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => api.restoreBackup(id, "RESTORE"),
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ["backups"] });
      setRestoreTarget(null);
      setConfirmText("");
      toast.success(result.message);
    },
    onError: (err) => {
      setError(
        err instanceof ApiClientError ? err.message : "Cannot reach the server",
      );
    },
  });

  const columns = useMemo<ColumnDef<BackupListItem>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: "Date",
        cell: ({ row }) =>
          new Date(row.original.createdAt).toLocaleString(),
      },
      {
        accessorKey: "sizeBytes",
        header: "Size",
        cell: ({ row }) => (
          <span className="tabular-nums">{formatBytes(row.original.sizeBytes)}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
      },
      {
        accessorKey: "verified",
        header: "Verified",
        cell: ({ row }) => (row.original.verified ? "Yes" : "No"),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={verifyMutation.isPending}
              onClick={() => verifyMutation.mutate(row.original.id)}
            >
              Verify
            </Button>
            {can("backup.restore") ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!row.original.verified}
                onClick={() => {
                  setRestoreTarget(row.original);
                  setConfirmText("");
                }}
              >
                Restore
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [can, verifyMutation],
  );

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">System & Backup</h1>
          <p className="mt-2 text-sm text-muted">
            Create, verify, and restore PostgreSQL + attachment backups.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? "Creating…" : "Create backup"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              const path = rootQuery.data?.path;
              if (!path) {
                setError("Backup folder path unavailable.");
                return;
              }
              if (window.bcis?.openPath) {
                const result = await window.bcis.openPath(path);
                if (!result.ok) setError(result.error ?? "Could not open folder");
              } else {
                setError(`Backup folder: ${path}`);
              }
            }}
          >
            Open folder
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-6">
        {backupsQuery.isLoading ? (
          <p className="text-sm text-muted">Loading backups…</p>
        ) : (
          <DataTable
            columns={columns}
            data={backupsQuery.data?.items ?? []}
          />
        )}
      </div>

      <Dialog
        open={Boolean(restoreTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setRestoreTarget(null);
            setConfirmText("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore backup</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted">
            This replaces the live database. A safety backup is created first.
            Type <span className="font-semibold text-ink">RESTORE</span> to
            confirm.
          </p>
          <div className="mt-4 space-y-2">
            <Label htmlFor="restore-confirm">Confirmation</Label>
            <Input
              id="restore-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="RESTORE"
            />
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRestoreTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                confirmText !== "RESTORE" ||
                !restoreTarget ||
                restoreMutation.isPending
              }
              onClick={() => {
                if (restoreTarget) restoreMutation.mutate(restoreTarget.id);
              }}
            >
              {restoreMutation.isPending ? "Restoring…" : "Restore"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
