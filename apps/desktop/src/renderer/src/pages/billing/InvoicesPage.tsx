import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { InvoiceListItem } from "@bcis/shared";
import { formatCentavos } from "@bcis/shared";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";

export function InvoicesPage() {
  const { api, can } = useAuth();
  const [params] = useSearchParams();
  const billingPeriod = params.get("billingPeriod") ?? undefined;

  const listQuery = useQuery({
    queryKey: ["invoices", billingPeriod],
    queryFn: () =>
      api.listInvoices({
        page: 1,
        pageSize: 100,
        billingPeriod,
      }),
    enabled: can("receivable.view"),
  });

  const columns = useMemo<ColumnDef<InvoiceListItem>[]>(
    () => [
      {
        accessorKey: "invoiceNumber",
        header: "Invoice",
        cell: ({ row }) => (
          <Link
            to={`/billing/invoices/${row.original.id}`}
            className="font-medium text-burgundy hover:underline"
          >
            {row.original.invoiceNumber}
          </Link>
        ),
      },
      { accessorKey: "billingPeriod", header: "Period" },
      { accessorKey: "subscriberName", header: "Subscriber" },
      { accessorKey: "serviceAccountNumber", header: "Service acct." },
      { accessorKey: "dueDate", header: "Due date" },
      {
        accessorKey: "totalCentavos",
        header: "Total",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatCentavos(BigInt(row.original.totalCentavos))}
          </span>
        ),
      },
      {
        accessorKey: "balanceCentavos",
        header: "Balance",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatCentavos(BigInt(row.original.balanceCentavos))}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    [],
  );

  if (!can("receivable.view")) {
    return <p className="text-sm text-muted">You do not have access to invoices.</p>;
  }

  if (listQuery.isError) {
    return (
      <p className="text-sm text-danger">
        {listQuery.error instanceof ApiClientError
          ? listQuery.error.message
          : "Failed to load invoices."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Invoices</h1>
        <p className="mt-1 text-sm text-muted">
          {billingPeriod
            ? `Showing period ${billingPeriod}`
            : "All posted invoices"}
        </p>
      </div>

      <DataTable
        columns={columns}
        data={listQuery.data?.items ?? []}
        searchPlaceholder="Search invoice or subscriber…"
      />
    </div>
  );
}
