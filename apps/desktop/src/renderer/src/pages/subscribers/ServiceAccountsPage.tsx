import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { formatCentavos, type ServiceAccountListItem } from "@bcis/shared";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";

export function ServiceAccountsPage() {
  const { api } = useAuth();

  const accountsQuery = useQuery({
    queryKey: ["service-accounts-all"],
    queryFn: () => api.listServiceAccounts({ page: 1, pageSize: 100 }),
  });

  const columns = useMemo<ColumnDef<ServiceAccountListItem>[]>(
    () => [
      { accessorKey: "accountNumber", header: "Service account" },
      { accessorKey: "subscriberAccountNumber", header: "Subscriber" },
      { accessorKey: "subscriberName", header: "Name" },
      { accessorKey: "planName", header: "Plan" },
      { accessorKey: "serviceTypeName", header: "Type" },
      {
        accessorKey: "currentRateCentavos",
        header: "Rate",
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatCentavos(BigInt(row.original.currentRateCentavos))}
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Service accounts</h1>
        <p className="mt-1 text-sm text-muted">
          Active services across all subscribers. Add new accounts from New
          subscriber.
        </p>
      </div>

      {accountsQuery.isError ? (
        <p className="text-sm text-danger">
          {accountsQuery.error instanceof ApiClientError
            ? accountsQuery.error.message
            : "Failed to load service accounts."}
        </p>
      ) : null}

      <DataTable
        columns={columns}
        data={accountsQuery.data?.items ?? []}
        searchPlaceholder="Search service accounts…"
      />
    </div>
  );
}
