import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Receipt,
  Wallet,
  Truck,
  Scale,
  Wrench,
  FileBarChart,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

type NavChild = {
  to: string;
  label: string;
  permission?: string;
};

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
  children?: NavChild[];
};

/** SPEC 4.3b navigation tree. */
const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  {
    to: "/subscribers",
    label: "Subscribers",
    icon: Users,
    permission: "subscriber.view",
    children: [
      { to: "/subscribers", label: "All", permission: "subscriber.view" },
      { to: "/subscribers/new", label: "New", permission: "subscriber.create" },
      {
        to: "/subscribers/service-accounts",
        label: "Service Accounts",
        permission: "subscriber.view",
      },
    ],
  },
  {
    to: "/billing",
    label: "Billing",
    icon: Receipt,
    permission: "billing.generate",
    children: [
      { to: "/billing", label: "Current", permission: "billing.generate" },
      { to: "/billing/generate", label: "Generate", permission: "billing.generate" },
      { to: "/billing/invoices", label: "Invoices", permission: "billing.generate" },
    ],
  },
  {
    to: "/payments",
    label: "Payments",
    icon: Wallet,
    permission: "payment.create",
    children: [
      { to: "/payments/receive", label: "Receive", permission: "payment.create" },
      { to: "/payments/history", label: "History", permission: "payment.create" },
      {
        to: "/payments/gcash",
        label: "GCash Verification",
        permission: "gcash.verify",
      },
    ],
  },
  {
    to: "/collections",
    label: "Collections",
    icon: Truck,
    permission: "collection.create",
    children: [
      {
        to: "/collections/collectors",
        label: "Collectors",
        permission: "collection.create",
      },
      {
        to: "/collections/areas",
        label: "Areas & Routes",
        permission: "collection.create",
      },
      {
        to: "/collections/batches",
        label: "Batches",
        permission: "collection.create",
      },
      {
        to: "/collections/remittance",
        label: "Remittance",
        permission: "collection.reconcile",
      },
    ],
  },
  {
    to: "/receivables",
    label: "Receivables",
    icon: Scale,
    permission: "receivable.view",
    children: [
      {
        to: "/receivables/outstanding",
        label: "Outstanding",
        permission: "receivable.view",
      },
      {
        to: "/receivables/overdue",
        label: "Overdue",
        permission: "receivable.view",
      },
      { to: "/receivables/aging", label: "Aging", permission: "receivable.view" },
      {
        to: "/receivables/suspension-candidates",
        label: "Suspension Candidates",
        permission: "receivable.view",
      },
    ],
  },
  { to: "/services", label: "Services", icon: Wrench, permission: "service.manage" },
  {
    to: "/reports",
    label: "Reports",
    icon: FileBarChart,
    permission: "report.view",
    children: [
      { to: "/reports", label: "All reports", permission: "report.view" },
      { to: "/reports/collections", label: "Collections", permission: "report.view" },
      { to: "/reports/ar-aging", label: "AR Aging", permission: "report.view" },
      { to: "/reports/ledger", label: "Ledger / SOA", permission: "report.view" },
      { to: "/reports/audit", label: "Audit log", permission: "audit.view" },
    ],
  },
  {
    to: "/administration",
    label: "Administration",
    icon: Settings,
    permission: "user.manage",
  },
];

function canSeeSection(
  can: (permission: string) => boolean,
  item: NavItem,
): boolean {
  if (item.permission && can(item.permission)) return true;
  if (item.children?.some((child) => !child.permission || can(child.permission))) {
    return true;
  }
  return !item.permission;
}

export function Sidebar() {
  const { can, user } = useAuth();

  const items = NAV.filter((item) => canSeeSection(can, item)).map((item) => ({
    ...item,
    children: item.children?.filter(
      (child) => !child.permission || can(child.permission),
    ),
  }));

  return (
    <aside className="flex h-full w-60 flex-col border-r border-border bg-surface">
      <div className="border-b border-border px-4 py-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-burgundy">
          BCIS
        </div>
        <div className="mt-1 text-sm font-semibold text-ink">
          Subscription Billing
        </div>
        <div className="mt-2 truncate text-xs text-muted">
          {user?.fullName}
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {items.map((item) => {
          const Icon = item.icon;
          const hasChildren = Boolean(item.children?.length);

          return (
            <div key={item.to}>
              {hasChildren ? (
                <div className="px-3 py-2 text-sm font-medium text-ink">
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0 text-muted" />
                    {item.label}
                  </span>
                </div>
              ) : (
                <NavLink
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-ink hover:bg-canvas",
                      isActive &&
                        "bg-canvas font-medium text-burgundy shadow-[inset_3px_0_0_0_#7A1F2B]",
                    )
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </NavLink>
              )}

              {hasChildren && (
                <div className="mb-1 ml-4 space-y-0.5 border-l border-border pl-2">
                  {item.children!.map((child) => (
                    <NavLink
                      key={child.to + child.label}
                      to={child.to}
                      end
                      className={({ isActive }) =>
                        cn(
                          "block rounded-md px-3 py-1.5 text-sm text-ink hover:bg-canvas",
                          isActive &&
                            "bg-canvas font-medium text-burgundy shadow-[inset_3px_0_0_0_#7A1F2B]",
                        )
                      }
                    >
                      {child.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
