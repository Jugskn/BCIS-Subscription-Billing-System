import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { formatCentavos, type DashboardDto } from "@bcis/shared";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "@/lib/auth";
import { ApiClientError } from "@/lib/api";
import { TabEmptyState } from "@/components/tab-empty-state";

const INK = "#111111";
const BURGUNDY = "#7A1F2B";
const MUTED = "#6B6B6B";
const BORDER = "#E7E5E4";

const AGING_COLORS = [
  "#E8C4C8",
  "#C47A84",
  "#A34A56",
  "#7A1F2B",
  "#5E1520",
] as const;

const METHOD_COLORS = [
  "#7A1F2B",
  "#A34A56",
  "#C47A84",
  "#5E1520",
  "#111111",
] as const;

const METHOD_LABELS: Record<string, string> = {
  Cash: "Cash",
  GCash: "GCash",
  BankTransfer: "Bank Transfer",
  Cheque: "Cheque",
  Other: "Other",
};

function Money({ value }: { value: string }) {
  return (
    <span className="tabular-nums">{formatCentavos(BigInt(value))}</span>
  );
}

function formatPesoTick(value: number): string {
  if (!Number.isFinite(value)) return "";
  // Axis ticks only — display approximation; tooltips use exact centavos.
  return formatCentavos(BigInt(Math.round(value)));
}

function ChartCard({
  title,
  children,
  empty,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  children: ReactNode;
  empty: boolean;
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <section className="border border-border bg-surface p-4">
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      {empty ? (
        <div className="mt-3">
          <TabEmptyState title={emptyTitle} description={emptyDescription} />
        </div>
      ) : (
        <div className="mt-3 h-64 w-full text-sm">{children}</div>
      )}
    </section>
  );
}

function pesoTooltipFormatter(value: unknown): [string, string] {
  const n = typeof value === "number" ? value : Number(value);
  const centavos = BigInt(Math.round(Number.isFinite(n) ? n : 0));
  return [formatCentavos(centavos), ""];
}

function BillingVsCollectionChart({
  rows,
}: {
  rows: DashboardDto["billingVsCollection"];
}) {
  const data = rows.map((r) => ({
    month: r.month,
    billed: Number(r.billedCentavos),
    collected: Number(r.collectedCentavos),
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={BORDER} vertical={false} />
        <XAxis dataKey="month" tick={{ fill: MUTED, fontSize: 12 }} />
        <YAxis
          tick={{ fill: MUTED, fontSize: 12 }}
          tickFormatter={formatPesoTick}
          width={88}
        />
        <Tooltip
          formatter={(value, name) => {
            const [formatted] = pesoTooltipFormatter(value);
            return [formatted, name === "billed" ? "Billed" : "Collected"];
          }}
          contentStyle={{ fontSize: 14 }}
        />
        <Legend wrapperStyle={{ fontSize: 14 }} />
        <Bar dataKey="billed" name="Billed" fill={INK} />
        <Bar dataKey="collected" name="Collected" fill={BURGUNDY} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function CollectionsTrendChart({
  rows,
}: {
  rows: DashboardDto["collectionsTrend"];
}) {
  const data = rows.map((r) => ({
    date: r.date.slice(5),
    collected: Number(r.collectedCentavos),
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={BORDER} vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: MUTED, fontSize: 11 }}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: MUTED, fontSize: 12 }}
          tickFormatter={formatPesoTick}
          width={88}
        />
        <Tooltip
          formatter={(value) => {
            const [formatted] = pesoTooltipFormatter(value);
            return [formatted, "Collected"];
          }}
          contentStyle={{ fontSize: 14 }}
        />
        <Line
          type="monotone"
          dataKey="collected"
          stroke={BURGUNDY}
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ArAgingChart({ aging }: { aging: DashboardDto["arAging"] }) {
  const data = aging.buckets.map((b, i) => ({
    bucket: b.bucket,
    balance: Number(b.balanceCentavos),
    balanceLabel: formatCentavos(BigInt(b.balanceCentavos)),
    fill: AGING_COLORS[i] ?? BURGUNDY,
  }));
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
          >
            <CartesianGrid stroke={BORDER} horizontal={false} />
            <XAxis
              type="number"
              tick={{ fill: MUTED, fontSize: 12 }}
              tickFormatter={formatPesoTick}
            />
            <YAxis
              type="category"
              dataKey="bucket"
              width={64}
              tick={{ fill: MUTED, fontSize: 12 }}
            />
            <Tooltip
              formatter={(value) => {
                const [formatted] = pesoTooltipFormatter(value);
                return [formatted, "Balance"];
              }}
              contentStyle={{ fontSize: 14 }}
            />
            <Bar dataKey="balance" name="Balance">
              {data.map((entry) => (
                <Cell key={entry.bucket} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-sm text-ink">
        Total: <Money value={aging.totalBalanceCentavos} />
      </p>
    </div>
  );
}

function PaymentMethodChart({
  rows,
}: {
  rows: DashboardDto["paymentMethods"];
}) {
  const total = rows.reduce((s, r) => s + BigInt(r.amountCentavos), 0n);
  const data = rows
    .filter((r) => BigInt(r.amountCentavos) > 0n)
    .map((r) => {
      const amount = BigInt(r.amountCentavos);
      const pct =
        total > 0n ? Number((amount * 10000n) / total) / 100 : 0;
      const methodIndex = rows.findIndex((row) => row.method === r.method);
      return {
        method: METHOD_LABELS[r.method] ?? r.method,
        amount: Number(r.amountCentavos),
        percent: pct,
        fill: METHOD_COLORS[methodIndex % METHOD_COLORS.length]!,
      };
    });

  return (
    <div className="flex h-full flex-col gap-2 sm:flex-row">
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="amount"
              nameKey="method"
              innerRadius="55%"
              outerRadius="80%"
              stroke={BORDER}
            >
              {data.map((entry) => (
                <Cell key={entry.method} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => {
                const [formatted] = pesoTooltipFormatter(value);
                return [formatted, String(name)];
              }}
              contentStyle={{ fontSize: 14 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-1 text-sm sm:w-44">
        {data.map((d) => (
          <li key={d.method} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-ink">
              <span
                className="inline-block size-2.5 shrink-0"
                style={{ backgroundColor: d.fill }}
              />
              {d.method}
            </span>
            <span className="tabular-nums text-muted">
              {d.percent.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CollectorPerformanceChart({
  rows,
}: {
  rows: DashboardDto["collectorPerformance"];
}) {
  const data = rows.map((r) => ({
    name: r.collectorName,
    collected: Number(r.collectedCentavos),
    expected: Number(r.expectedCentavos),
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
      >
        <CartesianGrid stroke={BORDER} horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: MUTED, fontSize: 12 }}
          tickFormatter={formatPesoTick}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={96}
          tick={{ fill: MUTED, fontSize: 12 }}
        />
        <Tooltip
          formatter={(value, name) => {
            const [formatted] = pesoTooltipFormatter(value);
            return [
              formatted,
              name === "collected" ? "Collected" : "Expected",
            ];
          }}
          contentStyle={{ fontSize: 14 }}
        />
        <Legend wrapperStyle={{ fontSize: 14 }} />
        <Bar dataKey="collected" name="Collected" fill={BURGUNDY} />
        <Bar dataKey="expected" name="Expected" fill={INK} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DashboardPage() {
  const { api, can, user } = useAuth();
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
  const firstName = user?.fullName.trim().split(/\s+/)[0] ?? "there";
  const kpis = [
    {
      label: "Today's collections",
      value: d.kpis.todayCollectionsCentavos,
      money: true,
    },
    {
      label: "Current receivable",
      value: d.kpis.currentReceivableCentavos,
      money: true,
    },
    {
      label: "Overdue receivable",
      value: d.kpis.overdueReceivableCentavos,
      money: true,
    },
    {
      label: "Subscribers overdue",
      value: String(d.kpis.subscribersOverdueCount),
      money: false,
    },
    {
      label: "Pending GCash",
      value: String(d.kpis.pendingGcashCount),
      money: false,
    },
  ];

  const billingEmpty = d.billingVsCollection.every(
    (r) => r.billedCentavos === "0" && r.collectedCentavos === "0",
  );
  const trendEmpty = d.collectionsTrend.every(
    (r) => r.collectedCentavos === "0",
  );
  const agingEmpty = d.arAging.totalInvoiceCount === 0;
  const methodsEmpty = d.paymentMethods.every((m) => m.count === 0);
  const collectorsEmpty = d.collectorPerformance.length === 0;
  const action =
    d.actionRequired.overdueSubscribersCount > 0 ||
    d.actionRequired.suspensionCandidatesCount > 0;

  return (
    <div className="space-y-6 text-sm">
      <div>
        <h1 className="text-2xl font-semibold text-ink">
          Hello, {firstName}
        </h1>
        <p className="mt-1 text-muted">Operational snapshot for today</p>
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

      {action ? (
        <div className="border border-warning/50 bg-surface px-4 py-3">
          <p className="font-medium text-ink">Action required</p>
          <p className="mt-2 text-muted">
            {d.actionRequired.overdueSubscribersCount > 0 ? (
              <>
                <Link
                  to="/receivables/overdue"
                  className="font-medium text-burgundy hover:underline"
                >
                  {d.actionRequired.overdueSubscribersCount} overdue
                  subscriber
                  {d.actionRequired.overdueSubscribersCount === 1 ? "" : "s"}
                </Link>
                {" need follow-up"}
              </>
            ) : (
              "No overdue subscribers"
            )}
            {" · "}
            {d.actionRequired.suspensionCandidatesCount > 0 ? (
              <Link
                to="/receivables/suspension-candidates"
                className="font-medium text-burgundy hover:underline"
              >
                {d.actionRequired.suspensionCandidatesCount} suspension
                candidate
                {d.actionRequired.suspensionCandidatesCount === 1 ? "" : "s"}
              </Link>
            ) : (
              "no suspension candidates"
            )}
            .
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Billing vs collection (last 6 months)"
          empty={billingEmpty}
          emptyTitle="No billing or collections"
          emptyDescription="No billed or collected amounts in this window."
        >
          <BillingVsCollectionChart rows={d.billingVsCollection} />
        </ChartCard>

        <ChartCard
          title="Collections trend (last 30 days)"
          empty={trendEmpty}
          emptyTitle="No collections"
          emptyDescription="No posted or verified payments in the last 30 days."
        >
          <CollectionsTrendChart rows={d.collectionsTrend} />
        </ChartCard>

        <ChartCard
          title="AR aging"
          empty={agingEmpty}
          emptyTitle="No open balances"
          emptyDescription="There are no open invoices to age."
        >
          <ArAgingChart aging={d.arAging} />
        </ChartCard>

        <ChartCard
          title="Payment method split (last 30 days)"
          empty={methodsEmpty}
          emptyTitle="No payments"
          emptyDescription="No payments in the last 30 days to split by method."
        >
          <PaymentMethodChart rows={d.paymentMethods} />
        </ChartCard>

        <div className="lg:col-span-2">
          <ChartCard
            title="Collector performance (last 30 days)"
            empty={collectorsEmpty}
            emptyTitle="No collector activity"
            emptyDescription="No assigned collectors or collections in this window."
          >
            <CollectorPerformanceChart rows={d.collectorPerformance} />
          </ChartCard>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">Recent payments</h2>
          {d.recentPayments.length === 0 ? (
            <div className="mt-3">
              <TabEmptyState
                title="No payments posted yet"
                description="Posted and verified payments will appear here."
              />
            </div>
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
                    <td className="py-1">
                      {METHOD_LABELS[p.method] ?? p.method}
                    </td>
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

        <section className="border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-ink">Overdue alerts</h2>
          {d.overdueAlerts.length === 0 ? (
            <div className="mt-3">
              <TabEmptyState
                title="No overdue alerts"
                description="No subscribers currently past grace."
              />
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {d.overdueAlerts.map((a) => (
                <li
                  key={a.subscriberId}
                  className="flex flex-wrap justify-between gap-2 border-b border-border pb-2"
                >
                  <Link
                    to={`/subscribers/${a.subscriberId}`}
                    className="text-burgundy hover:underline"
                  >
                    {a.accountNumber} — {a.fullName}
                  </Link>
                  <span className="tabular-nums text-ink">
                    <Money value={a.arrearsCentavos} /> · oldest due{" "}
                    {a.oldestDueDate}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
