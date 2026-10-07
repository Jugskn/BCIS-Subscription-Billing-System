import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { formatCentavos } from "@bcis/shared";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";
import { TabEmptyState } from "@/components/tab-empty-state";

function Money({ value }: { value: string }) {
  return (
    <span className="tabular-nums">{formatCentavos(BigInt(value))}</span>
  );
}

export function DashboardPage() {
  const { api, can } = useAuth();
  const enabled = can("receivable.view");

  const dash = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.getDashboard(),
    enabled,
  });

  if (!enabled) {
    return (
      <TabEmptyState
        title="Dashboard unavailable"
        description="You need receivable.view to see operational KPIs."
      />
    );
  }

  if (dash.isLoading) {
    return <p className="text-sm text-muted">Loading dashboard…</p>;
  }

  if (dash.isError || !dash.data) {
    return (
      <p className="text-sm text-danger">
        {dash.error instanceof ApiClientError
          ? dash.error.message
          : "Cannot reach the server"}
      </p>
    );
  }

  const d = dash.data;
  const kpis = [
    { label: "Today's collections", value: d.kpis.todayCollectionsCentavos, money: true },
    { label: "Current receivable", value: d.kpis.currentReceivableCentavos, money: true },
    { label: "Overdue receivable", value: d.kpis.overdueReceivableCentavos, money: true },
    { label: "Subscribers overdue", value: String(d.kpis.subscribersOverdueCount), money: false },
    { label: "Pending GCash", value: String(d.kpis.pendingGcashCount), money: false },
  ];

  return (
    <div className="space-y-6 text-sm">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Dashboard</h1>
        <p className="mt-1 text-muted">Operational overview</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="border border-border bg-surface px-4 py-3"
          >
            <p className="text-muted">{k.label}</p>
            <p className="mt-2 text-lg font-semibold text-ink">
              {k.money ? <Money value={k.value} /> : k.value}
            </p>
          </div>
        ))}
      </div>

      {d.overdueAlerts.length > 0 ? (
        <div className="border border-danger/40 bg-surface px-4 py-3">
          <p className="font-medium text-danger">Overdue alerts</p>
          <ul className="mt-2 space-y-1">
            {d.overdueAlerts.map((a) => (
              <li key={a.subscriberId} className="flex flex-wrap justify-between gap-2">
                <Link
                  to={`/subscribers/${a.subscriberId}`}
                  className="text-burgundy hover:underline"
                >
                  {a.accountNumber} — {a.fullName}
                </Link>
                <span className="tabular-nums text-ink">
                  <Money value={a.arrearsCentavos} /> · oldest due {a.oldestDueDate}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <TabEmptyState
          title="No overdue alerts"
          description="No subscribers currently past grace."
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="border border-border bg-surface p-4">
          <h2 className="font-medium text-ink">Billing vs collection (6 months)</h2>
          {d.billingVsCollection.every(
            (r) => r.billedCentavos === "0" && r.collectedCentavos === "0",
          ) ? (
            <p className="mt-3 text-muted">No billing or collections in this window.</p>
          ) : (
            <table className="mt-3 w-full">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="py-1 font-medium">Month</th>
                  <th className="py-1 text-right font-medium">Billed</th>
                  <th className="py-1 text-right font-medium">Collected</th>
                </tr>
              </thead>
              <tbody>
                {d.billingVsCollection.map((r) => (
                  <tr key={r.month} className="border-b border-border">
                    <td className="py-1">{r.month}</td>
                    <td className="py-1 text-right">
                      <Money value={r.billedCentavos} />
                    </td>
                    <td className="py-1 text-right">
                      <Money value={r.collectedCentavos} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="border border-border bg-surface p-4">
          <h2 className="font-medium text-ink">Payment methods (30 days)</h2>
          {d.paymentMethods.every((m) => m.count === 0) ? (
            <p className="mt-3 text-muted">No payments in the last 30 days.</p>
          ) : (
            <table className="mt-3 w-full">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="py-1 font-medium">Method</th>
                  <th className="py-1 text-right font-medium">Count</th>
                  <th className="py-1 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {d.paymentMethods.map((m) => (
                  <tr key={m.method} className="border-b border-border">
                    <td className="py-1">{m.method}</td>
                    <td className="py-1 text-right tabular-nums">{m.count}</td>
                    <td className="py-1 text-right">
                      <Money value={m.amountCentavos} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="border border-border bg-surface p-4">
          <h2 className="font-medium text-ink">AR aging</h2>
          {d.arAging.totalInvoiceCount === 0 ? (
            <p className="mt-3 text-muted">No open balances.</p>
          ) : (
            <table className="mt-3 w-full">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="py-1 font-medium">Bucket</th>
                  <th className="py-1 text-right font-medium">Invoices</th>
                  <th className="py-1 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {d.arAging.buckets.map((b) => (
                  <tr key={b.bucket} className="border-b border-border">
                    <td className="py-1">{b.bucket}</td>
                    <td className="py-1 text-right tabular-nums">{b.invoiceCount}</td>
                    <td className="py-1 text-right">
                      <Money value={b.balanceCentavos} />
                    </td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="py-1">Total</td>
                  <td className="py-1 text-right tabular-nums">
                    {d.arAging.totalInvoiceCount}
                  </td>
                  <td className="py-1 text-right">
                    <Money value={d.arAging.totalBalanceCentavos} />
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </section>

        <section className="border border-border bg-surface p-4">
          <h2 className="font-medium text-ink">Collector performance (30 days)</h2>
          {d.collectorPerformance.length === 0 ? (
            <p className="mt-3 text-muted">No collector activity in this window.</p>
          ) : (
            <table className="mt-3 w-full">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="py-1 font-medium">Collector</th>
                  <th className="py-1 text-right font-medium">Assigned</th>
                  <th className="py-1 text-right font-medium">Collected</th>
                </tr>
              </thead>
              <tbody>
                {d.collectorPerformance.map((c) => (
                  <tr
                    key={c.collectorUserId ?? "unassigned"}
                    className="border-b border-border"
                  >
                    <td className="py-1">{c.collectorName}</td>
                    <td className="py-1 text-right tabular-nums">
                      {c.assignedSubscribers}
                    </td>
                    <td className="py-1 text-right">
                      <Money value={c.collectedCentavos} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="border border-border bg-surface p-4">
        <h2 className="font-medium text-ink">Recent payments</h2>
        {d.recentPayments.length === 0 ? (
          <p className="mt-3 text-muted">No payments posted yet.</p>
        ) : (
          <table className="mt-3 w-full">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-1 font-medium">When</th>
                <th className="py-1 font-medium">Subscriber</th>
                <th className="py-1 font-medium">Method</th>
                <th className="py-1 font-medium">Receipt</th>
                <th className="py-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {d.recentPayments.map((p) => (
                <tr key={p.id} className="border-b border-border">
                  <td className="py-1">
                    {new Date(p.receivedAt).toLocaleString("en-PH")}
                  </td>
                  <td className="py-1">
                    {p.accountNumber} — {p.subscriberName}
                  </td>
                  <td className="py-1">{p.method}</td>
                  <td className="py-1">{p.receiptNumber ?? "—"}</td>
                  <td className="py-1 text-right">
                    <Money value={p.amountCentavos} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
