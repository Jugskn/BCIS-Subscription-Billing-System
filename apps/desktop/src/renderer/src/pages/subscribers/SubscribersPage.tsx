import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatPhilippineMobile, type SubscriberListItem } from "@bcis/shared";
import { DataTable } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";

export function SubscribersPage() {
  const { api, can } = useAuth();
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");

  const listQuery = useQuery({
    queryKey: ["subscribers", submitted],
    queryFn: () =>
      submitted
        ? api.searchSubscribers({ q: submitted, page: 1, pageSize: 100 })
        : api.listSubscribers({ page: 1, pageSize: 100 }),
  });

  const columns = useMemo<ColumnDef<SubscriberListItem>[]>(
    () => [
      {
        accessorKey: "accountNumber",
        header: "Account no.",
        cell: ({ row }) => (
          <Link
            to={`/subscribers/${row.original.id}`}
            className="font-medium text-burgundy hover:underline"
          >
            {row.original.accountNumber}
          </Link>
        ),
      },
      { accessorKey: "fullName", header: "Name" },
      {
        accessorKey: "contactPhone",
        header: "Contact",
        cell: ({ row }) => formatPhilippineMobile(row.original.contactPhone) || "—",
      },
      { accessorKey: "address", header: "Address" },
      { accessorKey: "collectionAreaName", header: "Area" },
      { accessorKey: "dueDay", header: "Due day" },
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Subscribers</h1>
          <p className="mt-1 text-sm text-muted">
            Search by account number, name, contact, or address.
          </p>
        </div>
        {can("subscriber.create") ? (
          <Button asChild>
            <Link to="/subscribers/new">New subscriber</Link>
          </Button>
        ) : null}
      </div>

      <form
        className="flex max-w-xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(search.trim());
        }}
      >
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Global search…"
        />
        <Button type="submit">Search</Button>
        {submitted ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSearch("");
              setSubmitted("");
            }}
          >
            Clear
          </Button>
        ) : null}
      </form>

      {listQuery.isError ? (
        <p className="text-sm text-danger">
          {listQuery.error instanceof ApiClientError
            ? listQuery.error.message
            : "Failed to load subscribers."}
        </p>
      ) : null}

      <DataTable
        columns={columns}
        data={listQuery.data?.items ?? []}
        searchPlaceholder="Filter loaded results…"
      />
    </div>
  );
}
