import {
  PERMISSIONS,
  ROLE_PERMISSION_MATRIX,
  ROLES,
  type PermissionCode,
  type RoleName,
} from "@bcis/shared";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function RolesPage() {
  const { can } = useAuth();

  if (
    !can("user.manage") &&
    !can("role.manage") &&
    !can("settings.view")
  ) {
    return (
      <p className="text-sm text-muted">
        You do not have permission to view roles and permissions.
      </p>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Roles and Permissions</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Read-only matrix of the seeded role → permission grants (SPEC 3.1 / 4.4).
        Effective permissions are enforced server-side on every route.
      </p>

      <div className="mt-6 overflow-auto border border-border bg-surface">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 border-b border-border bg-canvas text-left">
            <tr>
              <th className="px-2 py-2 font-medium text-muted">Permission</th>
              {ROLES.map((role) => (
                <th
                  key={role}
                  className="px-2 py-2 font-medium text-muted whitespace-nowrap"
                >
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((perm) => (
              <tr key={perm} className="border-b border-border">
                <td className="px-2 py-1.5 font-medium text-ink whitespace-nowrap">
                  {perm}
                </td>
                {ROLES.map((role) => {
                  const granted = hasGrant(role, perm);
                  return (
                    <td
                      key={role}
                      className={cn(
                        "px-2 py-1.5 text-center",
                        granted ? "text-success" : "text-muted",
                      )}
                    >
                      {granted ? "Yes" : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function hasGrant(role: RoleName, perm: PermissionCode): boolean {
  return ROLE_PERMISSION_MATRIX[role].includes(perm);
}
