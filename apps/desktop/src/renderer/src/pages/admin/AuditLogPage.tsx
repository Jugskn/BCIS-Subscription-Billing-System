import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function AuditLogPage() {
  const { api, can } = useAuth();
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(today());
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const params = {
    fromDate,
    toDate,
    action: action || undefined,
    entityType: entityType || undefined,
    page,
    pageSize,
  };

  const q = useQuery({
    queryKey: ["admin-audit", params],
    queryFn: () => api.getAuditReport(params),
    enabled: can("audit.view"),
  });

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      {
        accessorKey: "at",
        header: "Date",
        cell: ({ getValue }) =>
          new Date(String(getValue())).toLocaleString("en-PH"),
      },
      { accessorKey: "actorName", header: "Actor" },
      { accessorKey: "action", header: "Action" },
      { accessorKey: "entityType", header: "Entity" },
      {
        accessorKey: "entityId",
        header: "Entity ID",
        cell: ({ getValue }) => {
          const v = getValue();
          if (!v) return "—";
          const s = String(v);
          return s.length > 12 ? `${s.slice(0, 8)}…` : s;
        },
      },
      {
        accessorKey: "reason",
        header: "Reason",
        cell: ({ getValue }) => String(getValue() ?? "—"),
      },
    ],
    [],
  );

  if (!can("audit.view")) {
    return (
      <p className="text-sm text-muted">
        Audit log requires the audit.view permission.
      </p>
    );
  }

  const total = q.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Audit Log</h1>
          <p className="mt-2 text-sm text-muted">
            Read-only trail of authenticated actions. No edit or delete.
          </p>
        </div>
        {can("report.export") ? (
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void api.downloadReportExport("/reports/audit/export", {
                ...params,
                format: "xlsx",
              })
            }
          >
            Export XLSX
          </Button>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <div>
          <Label htmlFor="from">From</Label>
          <Input
            id="from"
            type="date"
            className="mt-1"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div>
          <Label htmlFor="to">To</Label>
          <Input
            id="to"
            type="date"
            className="mt-1"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div>
          <Label htmlFor="action">Action</Label>
          <Input
            id="action"
            className="mt-1"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div>
          <Label htmlFor="entity">Entity</Label>
          <Input
            id="entity"
            className="mt-1"
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {q.isError ? (
        <p className="mt-4 text-sm text-danger">
          {q.error instanceof ApiClientError
            ? q.error.message
            : "Could not load audit log."}
        </p>
      ) : null}

      {!q.isLoading && total === 0 ? (
        <p className="mt-6 text-sm text-muted">No audit entries for these filters.</p>
      ) : (
        <div className="mt-4">
          <DataTable
            columns={columns}
            data={(q.data?.items as Record<string, unknown>[]) ?? []}
          />
          <div className="mt-3 flex items-center justify-between text-sm text-muted">
            <span>
              Page {page} of {totalPages} · {total} total
            </span>
            <div className="flex gap-2">
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
        </div>
      )}
    </div>
  );
}
