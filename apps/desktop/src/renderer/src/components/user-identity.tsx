import type { SessionUser } from "@bcis/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts.at(-1)![0]}`.toUpperCase();
}

export function UserIdentity({
  user,
  align = "left",
}: {
  user: SessionUser;
  align?: "left" | "right";
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-burgundy text-xs font-semibold text-white">
        {initials(user.fullName)}
      </div>
      <div className={cn("min-w-0", align === "right" && "text-right")}>
        <p className="truncate text-sm font-medium text-ink">{user.fullName}</p>
        <Badge className="mt-0.5">{user.roles[0] ?? "User"}</Badge>
      </div>
    </div>
  );
}
