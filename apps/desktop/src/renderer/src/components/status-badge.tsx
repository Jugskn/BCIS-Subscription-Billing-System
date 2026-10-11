import { Badge } from "@/components/ui/badge";

const STATUS_VARIANT: Record<
  string,
  "success" | "warning" | "danger" | "muted" | "default"
> = {
  ACTIVE: "success",
  INACTIVE: "muted",
  SUSPENDED: "warning",
  TERMINATED: "danger",
  ARCHIVED: "muted",
  PAID: "success",
  UNPAID: "warning",
  PARTIALLY_PAID: "warning",
  OVERDUE: "danger",
  VOID: "muted",
  CREDITED: "muted",
  DRAFT: "default",
  POSTED: "success",
  PENDING: "warning",
  VERIFIED: "success",
  REJECTED: "danger",
  REVERSED: "muted",
  ISSUED: "success",
  OPEN: "default",
  IN_PROGRESS: "warning",
  SUBMITTED: "warning",
  REMITTED: "default",
  RECONCILED: "success",
  CLOSED: "muted",
  COMPLETED: "success",
  CANCELLED: "muted",
  RECORDED: "default",
  SUSPENSION: "warning",
  RECONNECTION: "success",
  "1-30": "warning",
  "31-60": "warning",
  "61-90": "danger",
  "90+": "danger",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "default"}>{status}</Badge>
  );
}
