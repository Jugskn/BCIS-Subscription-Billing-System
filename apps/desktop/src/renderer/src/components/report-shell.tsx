import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";
import { useState } from "react";

type ReportShellProps = {
  title: string;
  description: string;
  filters?: React.ReactNode;
  children: React.ReactNode;
  exportPath?: string;
  exportParams?: Record<string, string | number | undefined>;
  /** When set, export requires this permission instead of report.export (e.g. audit). */
  exportPermission?: string;
  totals?: React.ReactNode;
  error?: unknown;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
};

export function ReportShell({
  title,
  description,
  filters,
  children,
  exportPath,
  exportParams = {},
  exportPermission = "report.export",
  totals,
  error,
  empty,
  emptyTitle = "No rows for these filters",
  emptyDescription = "Adjust the date range or filters and try again.",
}: ReportShellProps) {
  const { api, can } = useAuth();
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);

  async function doExport(format: "pdf" | "xlsx") {
    if (!exportPath) return;
    setExportError(null);
    setExporting(format);
    try {
      await api.downloadReportExport(exportPath, { ...exportParams, format });
    } catch (err) {
      setExportError(
        err instanceof ApiClientError ? err.message : "Cannot reach the server",
      );
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/reports" className="text-burgundy hover:underline">
            ← Reports
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-ink">{title}</h1>
          <p className="mt-1 text-muted">{description}</p>
        </div>
        {exportPath && can(exportPermission) ? (
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

      {filters ? (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface p-4">
          {filters}
        </div>
      ) : null}

      {exportError ? <p className="text-danger">{exportError}</p> : null}
      {error ? (
        <p className="text-danger">
          {error instanceof ApiClientError
            ? error.message
            : "Cannot reach the server"}
        </p>
      ) : null}

      {totals}

      {empty ? (
        <div className="rounded-md border border-border bg-surface px-6 py-10 text-center">
          <h3 className="font-medium text-ink">{emptyTitle}</h3>
          <p className="mt-2 text-muted">{emptyDescription}</p>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
