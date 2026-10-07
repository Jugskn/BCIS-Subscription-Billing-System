import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { formatCentavos } from "@bcis/shared";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";

export function CurrentBillingPage() {
  const { api, can } = useAuth();

  const cycleQuery = useQuery({
    queryKey: ["billing-current"],
    queryFn: () => api.getCurrentBilling(),
    enabled: can("billing.generate"),
  });

  if (!can("billing.generate")) {
    return <p className="text-sm text-muted">You do not have access to billing.</p>;
  }

  if (cycleQuery.isLoading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  if (cycleQuery.isError) {
    return (
      <p className="text-sm text-danger">
        {cycleQuery.error instanceof ApiClientError
          ? cycleQuery.error.message
          : "Failed to load billing cycle."}
      </p>
    );
  }

  const cycle = cycleQuery.data!;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Current Billing</h1>
          <p className="mt-1 text-sm text-muted">
            Billing period {cycle.billingPeriod}
          </p>
        </div>
        <Button asChild>
          <Link to="/billing/generate">Generate billing</Link>
        </Button>
      </div>

      <dl className="grid max-w-lg gap-4 sm:grid-cols-2">
        <Stat label="Period" value={cycle.billingPeriod} />
        <Stat label="Status" value={cycle.status} />
        <Stat label="Invoices" value={String(cycle.invoiceCount)} />
        <Stat
          label="Total billed"
          value={formatCentavos(BigInt(cycle.totalCentavos))}
          numeric
        />
        <Stat
          label="Generated"
          value={
            cycle.generatedAt
              ? new Date(cycle.generatedAt).toLocaleString()
              : "Not yet generated"
          }
          className="sm:col-span-2"
        />
      </dl>

      <Button variant="outline" asChild>
        <Link to={`/billing/invoices?billingPeriod=${cycle.billingPeriod}`}>
          View invoices for this period
        </Link>
      </Button>
    </div>
  );
}

function Stat({
  label,
  value,
  numeric,
  className,
}: {
  label: string;
  value: string;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd
        className={`mt-1 text-sm text-ink ${numeric ? "tabular-nums" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
