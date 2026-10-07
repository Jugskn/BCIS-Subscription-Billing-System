import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { formatCentavos } from "@bcis/shared";
import { DataTable } from "@/components/data-table";
import { ReportShell } from "@/components/report-shell";
import { AsyncCombobox, type AsyncComboboxOption } from "@/components/async-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

function moneyCell(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return (
    <span className="block text-right tabular-nums">
      {formatCentavos(BigInt(String(value)))}
    </span>
  );
}

function DateFilters({
  fromDate,
  toDate,
  onFrom,
  onTo,
}: {
  fromDate: string;
  toDate: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <>
      <div>
        <Label htmlFor="fromDate">From</Label>
        <Input
          id="fromDate"
          type="date"
          value={fromDate}
          onChange={(e) => onFrom(e.target.value)}
          className="mt-1"
        />
      </div>
      <div>
        <Label htmlFor="toDate">To</Label>
        <Input
          id="toDate"
          type="date"
          value={toDate}
          onChange={(e) => onTo(e.target.value)}
          className="mt-1"
        />
      </div>
    </>
  );
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const t = today();
  return `${t.slice(0, 7)}-01`;
}

export function CollectionsReportPage() {
  const { api } = useAuth();
  const [period, setPeriod] = useState("monthly");
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(today());
  const params = { period, fromDate, toDate, page: 1, pageSize: 100 };

  const q = useQuery({
    queryKey: ["report-collections", params],
    queryFn: () => api.getCollectionsReport(params),
  });

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      {
        accessorKey: "receivedAt",
        header: "Received",
        cell: ({ getValue }) =>
          new Date(String(getValue())).toLocaleString("en-PH"),
      },
      { accessorKey: "accountNumber", header: "Account" },
      { accessorKey: "subscriberName", header: "Subscriber" },
      { accessorKey: "method", header: "Method" },
      { accessorKey: "receiptNumber", header: "Receipt" },
      {
        accessorKey: "amountCentavos",
        header: "Amount",
        cell: ({ getValue }) => moneyCell(getValue()),
      },
    ],
    [],
  );

  return (
    <ReportShell
      title="Collection Report"
      description="Daily, weekly, monthly, or annual collections."
      exportPath="/reports/collections/export"
      exportParams={params}
      error={q.error}
      empty={!q.isLoading && (q.data?.total ?? 0) === 0}
      totals={
        q.data ? (
          <p className="text-ink">
            Total:{" "}
            <span className="font-medium tabular-nums">
              {formatCentavos(BigInt(q.data.totals.amountCentavos))}
            </span>{" "}
            ({q.data.totals.count} payments)
          </p>
        ) : null
      }
      filters={
        <>
          <div>
            <Label htmlFor="period">Period</Label>
            <select
              id="period"
              className="mt-1 flex h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </select>
          </div>
          <DateFilters
            fromDate={fromDate}
            toDate={toDate}
            onFrom={setFromDate}
            onTo={setToDate}
          />
        </>
      }
    >
      <DataTable columns={columns} data={(q.data?.items as Record<string, unknown>[]) ?? []} />
    </ReportShell>
  );
}

export function PaymentMethodsReportPage() {
  const { api } = useAuth();
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(today());
  const params = { fromDate, toDate, page: 1, pageSize: 100 };
  const q = useQuery({
    queryKey: ["report-payment-methods", params],
    queryFn: () => api.getPaymentMethodsReport(params),
  });
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      { accessorKey: "method", header: "Method" },
      { accessorKey: "count", header: "Count" },
      {
        accessorKey: "amountCentavos",
        header: "Amount",
        cell: ({ getValue }) => moneyCell(getValue()),
      },
    ],
    [],
  );
  return (
    <ReportShell
      title="Payment Method Summary"
      description="Collections by payment method."
      exportPath="/reports/payment-methods/export"
      exportParams={params}
      error={q.error}
      empty={!q.isLoading && (q.data?.totals.count ?? 0) === 0}
      filters={
        <DateFilters fromDate={fromDate} toDate={toDate} onFrom={setFromDate} onTo={setToDate} />
      }
      totals={
        q.data ? (
          <p>
            Total{" "}
            <span className="font-medium tabular-nums">
              {formatCentavos(BigInt(q.data.totals.amountCentavos))}
            </span>
          </p>
        ) : null
      }
    >
      <DataTable columns={columns} data={(q.data?.items as Record<string, unknown>[]) ?? []} />
    </ReportShell>
  );
}

export function BillingVsCollectionReportPage() {
  const { api } = useAuth();
  const [months, setMonths] = useState(12);
  const q = useQuery({
    queryKey: ["report-bvc", months],
    queryFn: () => api.getBillingVsCollectionReport(months),
  });
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      { accessorKey: "month", header: "Month" },
      {
        accessorKey: "billedCentavos",
        header: "Billed",
        cell: ({ getValue }) => moneyCell(getValue()),
      },
      {
        accessorKey: "collectedCentavos",
        header: "Collected",
        cell: ({ getValue }) => moneyCell(getValue()),
      },
    ],
    [],
  );
  return (
    <ReportShell
      title="Billing vs Collection"
      description="Compare billed invoice totals to collections by month."
      exportPath="/reports/billing-vs-collection/export"
      exportParams={{ months }}
      error={q.error}
      empty={!q.isLoading && (q.data?.total ?? 0) === 0}
      filters={
        <div>
          <Label htmlFor="months">Months</Label>
          <Input
            id="months"
            type="number"
            min={1}
            max={24}
            value={months}
            onChange={(e) => setMonths(Number(e.target.value) || 12)}
            className="mt-1 w-28"
          />
        </div>
      }
    >
      <DataTable columns={columns} data={(q.data?.items as Record<string, unknown>[]) ?? []} />
    </ReportShell>
  );
}

export function RevenueReportPage() {
  const { api } = useAuth();
  const [groupBy, setGroupBy] = useState("plan");
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(today());
  const params = { groupBy, fromDate, toDate, page: 1, pageSize: 100 };
  const q = useQuery({
    queryKey: ["report-revenue", params],
    queryFn: () => api.getRevenueReport(params),
  });
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      { accessorKey: "groupCode", header: "Code" },
      { accessorKey: "groupName", header: "Name" },
      { accessorKey: "invoiceCount", header: "Invoices" },
      {
        accessorKey: "amountCentavos",
        header: "Amount",
        cell: ({ getValue }) => moneyCell(getValue()),
      },
    ],
    [],
  );
  return (
    <ReportShell
      title="Revenue Report"
      description="Revenue by plan, service type, or collection area."
      exportPath="/reports/revenue/export"
      exportParams={params}
      error={q.error}
      empty={!q.isLoading && (q.data?.total ?? 0) === 0}
      filters={
        <>
          <div>
            <Label htmlFor="groupBy">Group by</Label>
            <select
              id="groupBy"
              className="mt-1 flex h-10 rounded-md border border-border bg-surface px-3 text-sm"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
            >
              <option value="plan">Plan</option>
              <option value="serviceType">Service type</option>
              <option value="area">Area</option>
            </select>
          </div>
          <DateFilters fromDate={fromDate} toDate={toDate} onFrom={setFromDate} onTo={setToDate} />
        </>
      }
    >
      <DataTable columns={columns} data={(q.data?.items as Record<string, unknown>[]) ?? []} />
    </ReportShell>
  );
}

export function ArAgingReportPage() {
  const { api } = useAuth();
  const params = { page: 1, pageSize: 100 };
  const q = useQuery({
    queryKey: ["report-ar-aging", params],
    queryFn: () => api.getArAgingReport(params),
  });
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      { accessorKey: "invoiceNumber", header: "Invoice" },
      { accessorKey: "accountNumber", header: "Account" },
      { accessorKey: "subscriberName", header: "Subscriber" },
      { accessorKey: "dueDate", header: "Due" },
      { accessorKey: "bucket", header: "Bucket" },
      {
        accessorKey: "balanceCentavos",
        header: "Balance",
        cell: ({ getValue }) => moneyCell(getValue()),
      },
    ],
    [],
  );
  return (
    <ReportShell
      title="AR Aging"
      description="Open invoice balances by days past due."
      exportPath="/reports/ar-aging/export"
      exportParams={params}
      error={q.error}
      empty={!q.isLoading && (q.data?.total ?? 0) === 0}
      totals={
        q.data ? (
          <div className="flex flex-wrap gap-4">
            {q.data.summary.buckets.map((b) => (
              <p key={b.bucket}>
                {b.bucket}:{" "}
                <span className="tabular-nums">
                  {formatCentavos(BigInt(b.balanceCentavos))}
                </span>
              </p>
            ))}
            <p className="font-medium">
              Total:{" "}
              <span className="tabular-nums">
                {formatCentavos(BigInt(q.data.summary.totalBalanceCentavos))}
              </span>
            </p>
          </div>
        ) : null
      }
    >
      <DataTable columns={columns} data={(q.data?.items as Record<string, unknown>[]) ?? []} />
    </ReportShell>
  );
}

export function SubscriberMasterReportPage() {
  const { api } = useAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const params = {
    page: 1,
    pageSize: 100,
    search: search || undefined,
    status: status || undefined,
  };
  const q = useQuery({
    queryKey: ["report-subscribers", params],
    queryFn: () => api.getSubscriberMasterReport(params),
  });
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      { accessorKey: "accountNumber", header: "Account" },
      { accessorKey: "fullName", header: "Name" },
      { accessorKey: "contactPhone", header: "Phone" },
      { accessorKey: "status", header: "Status" },
      { accessorKey: "areaName", header: "Area" },
      { accessorKey: "collectorName", header: "Collector" },
    ],
    [],
  );
  return (
    <ReportShell
      title="Subscriber Master List"
      description="Directory of subscribers."
      exportPath="/reports/subscribers/export"
      exportParams={params}
      error={q.error}
      empty={!q.isLoading && (q.data?.total ?? 0) === 0}
      filters={
        <>
          <div>
            <Label htmlFor="search">Search</Label>
            <Input
              id="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              className="mt-1 flex h-10 rounded-md border border-border bg-surface px-3 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
              <option value="TERMINATED">TERMINATED</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
          </div>
        </>
      }
    >
      <DataTable columns={columns} data={(q.data?.items as Record<string, unknown>[]) ?? []} />
    </ReportShell>
  );
}

export function LedgerReportPage() {
  const { api } = useAuth();
  const [subscriberId, setSubscriberId] = useState("");
  const [subscriberLabel, setSubscriberLabel] = useState("");
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(today());
  const enabled = Boolean(subscriberId);
  const params = { subscriberId, fromDate, toDate, page: 1, pageSize: 100 };
  const q = useQuery({
    queryKey: ["report-ledger", params],
    queryFn: () => api.getLedgerReport(params),
    enabled,
  });
  const loadSubscribers = async (search: string): Promise<AsyncComboboxOption[]> => {
    const items = await api.subscriberOptions(search || undefined);
    return items.map((s) => ({
      value: s.id,
      label: `${s.accountNumber} — ${s.fullName}`,
    }));
  };
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      { accessorKey: "entryDate", header: "Date" },
      { accessorKey: "referenceType", header: "Type" },
      { accessorKey: "description", header: "Description" },
      {
        accessorKey: "debitCentavos",
        header: "Debit",
        cell: ({ getValue }) => moneyCell(getValue()),
      },
      {
        accessorKey: "creditCentavos",
        header: "Credit",
        cell: ({ getValue }) => moneyCell(getValue()),
      },
      {
        accessorKey: "balanceCentavos",
        header: "Balance",
        cell: ({ getValue }) => moneyCell(getValue()),
      },
    ],
    [],
  );
  return (
    <ReportShell
      title="Subscriber Ledger / SOA"
      description="Opening balance, debits, credits, running and closing balance."
      exportPath={enabled ? "/reports/ledger/export" : undefined}
      exportParams={params}
      error={q.error}
      empty={enabled && !q.isLoading && (q.data?.total ?? 0) === 0}
      emptyTitle={!enabled ? "Select a subscriber" : undefined}
      emptyDescription={
        !enabled
          ? "Choose a subscriber and date range to preview the ledger."
          : undefined
      }
      filters={
        <>
          <div className="min-w-[240px] flex-1">
            <Label>Subscriber</Label>
            <div className="mt-1">
              <AsyncCombobox
                value={subscriberId}
                selectedLabel={subscriberLabel}
                loadOptions={loadSubscribers}
                placeholder="Account or name"
                onChange={(v, opt) => {
                  setSubscriberId(v);
                  setSubscriberLabel(opt?.label ?? "");
                }}
              />
            </div>
          </div>
          <DateFilters fromDate={fromDate} toDate={toDate} onFrom={setFromDate} onTo={setToDate} />
          {enabled ? (
            <Button type="button" variant="outline" asChild>
              <Link
                to={`/print/soa/${subscriberId}?fromDate=${fromDate}&toDate=${toDate}`}
              >
                Print SOA
              </Link>
            </Button>
          ) : null}
        </>
      }
      totals={
        q.data?.statement ? (
          <p>
            Opening{" "}
            <span className="tabular-nums">
              {formatCentavos(BigInt(q.data.statement.openingBalanceCentavos))}
            </span>
            {" · "}
            Closing{" "}
            <span className="tabular-nums font-medium">
              {formatCentavos(BigInt(q.data.statement.closingBalanceCentavos))}
            </span>
          </p>
        ) : null
      }
    >
      {enabled ? (
        <DataTable columns={columns} data={(q.data?.items as Record<string, unknown>[]) ?? []} />
      ) : (
        <div className="rounded-md border border-border bg-surface px-6 py-10 text-center text-muted">
          Select a subscriber to load the ledger.
        </div>
      )}
    </ReportShell>
  );
}

export function CollectorReportPage() {
  const { api } = useAuth();
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(today());
  const params = { fromDate, toDate, page: 1, pageSize: 100 };
  const q = useQuery({
    queryKey: ["report-collectors", params],
    queryFn: () => api.getCollectorReport(params),
  });
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      { accessorKey: "collectorName", header: "Collector" },
      { accessorKey: "assignedSubscribers", header: "Assigned" },
      { accessorKey: "paymentCount", header: "Payments" },
      {
        accessorKey: "collectedCentavos",
        header: "Collected",
        cell: ({ getValue }) => moneyCell(getValue()),
      },
      {
        accessorKey: "remittedCentavos",
        header: "Remitted",
        cell: ({ getValue }) => moneyCell(getValue()),
      },
      {
        accessorKey: "shortageOverageCentavos",
        header: "Shortage/Overage",
        cell: ({ getValue }) => moneyCell(getValue()),
      },
    ],
    [],
  );
  return (
    <ReportShell
      title="Collector Remittance & Performance"
      description="Collected vs remitted by assigned collector."
      exportPath="/reports/collectors/export"
      exportParams={params}
      error={q.error}
      empty={!q.isLoading && (q.data?.total ?? 0) === 0}
      filters={
        <DateFilters fromDate={fromDate} toDate={toDate} onFrom={setFromDate} onTo={setToDate} />
      }
    >
      <DataTable columns={columns} data={(q.data?.items as Record<string, unknown>[]) ?? []} />
    </ReportShell>
  );
}

export function ReversalsReportPage() {
  const { api } = useAuth();
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(today());
  const params = { fromDate, toDate, page: 1, pageSize: 100 };
  const q = useQuery({
    queryKey: ["report-reversals", params],
    queryFn: () => api.getReversalsReport(params),
  });
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      {
        accessorKey: "at",
        header: "When",
        cell: ({ getValue }) =>
          getValue() ? new Date(String(getValue())).toLocaleString("en-PH") : "—",
      },
      { accessorKey: "kind", header: "Kind" },
      { accessorKey: "accountNumber", header: "Account" },
      { accessorKey: "receiptNumber", header: "Receipt" },
      {
        accessorKey: "amountCentavos",
        header: "Amount",
        cell: ({ getValue }) => moneyCell(getValue()),
      },
      { accessorKey: "reason", header: "Reason" },
    ],
    [],
  );
  return (
    <ReportShell
      title="Payment Reversals & Voided Receipts"
      description="Reversals and voided receipts."
      exportPath="/reports/reversals/export"
      exportParams={params}
      error={q.error}
      empty={!q.isLoading && (q.data?.total ?? 0) === 0}
      filters={
        <DateFilters fromDate={fromDate} toDate={toDate} onFrom={setFromDate} onTo={setToDate} />
      }
    >
      <DataTable columns={columns} data={(q.data?.items as Record<string, unknown>[]) ?? []} />
    </ReportShell>
  );
}

export function AuditReportPage() {
  const { api, can } = useAuth();
  const [fromDate, setFromDate] = useState(monthStart());
  const [toDate, setToDate] = useState(today());
  const [action, setAction] = useState("");
  const params = {
    fromDate,
    toDate,
    action: action || undefined,
    page: 1,
    pageSize: 100,
  };
  const q = useQuery({
    queryKey: ["report-audit", params],
    queryFn: () => api.getAuditReport(params),
    enabled: can("audit.view"),
  });
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      {
        accessorKey: "at",
        header: "When",
        cell: ({ getValue }) =>
          new Date(String(getValue())).toLocaleString("en-PH"),
      },
      { accessorKey: "actorName", header: "Actor" },
      { accessorKey: "action", header: "Action" },
      { accessorKey: "entityType", header: "Entity" },
      { accessorKey: "reason", header: "Reason" },
    ],
    [],
  );
  if (!can("audit.view")) {
    return (
      <p className="text-sm text-muted">
        Audit report is available to Owner and Auditor only.
      </p>
    );
  }
  return (
    <ReportShell
      title="Audit Log & User Activity"
      description="Read-only audit trail."
      exportPath="/reports/audit/export"
      exportParams={params}
      exportPermission="report.export"
      error={q.error}
      empty={!q.isLoading && (q.data?.total ?? 0) === 0}
      filters={
        <>
          <DateFilters fromDate={fromDate} toDate={toDate} onFrom={setFromDate} onTo={setToDate} />
          <div>
            <Label htmlFor="action">Action contains</Label>
            <Input
              id="action"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="mt-1"
            />
          </div>
        </>
      }
    >
      <DataTable columns={columns} data={(q.data?.items as Record<string, unknown>[]) ?? []} />
    </ReportShell>
  );
}
