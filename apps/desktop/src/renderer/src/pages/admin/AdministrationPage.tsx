import { Link } from "react-router-dom";
import { useAuth } from "@/lib/auth";

export function AdministrationPage() {
  const { can } = useAuth();
  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Administration</h1>
      <p className="mt-2 text-sm text-muted">
        System administration tools for users, settings, audit, and backups.
      </p>
      <ul className="mt-6 space-y-2 text-sm">
        {can("user.manage") ? (
          <li>
            <Link
              className="text-burgundy hover:underline"
              to="/administration/users"
            >
              Users
            </Link>
            <span className="text-muted">
              {" "}
              — list, create, deactivate, assign roles
            </span>
          </li>
        ) : null}
        {can("user.manage") || can("role.manage") || can("settings.view") ? (
          <li>
            <Link
              className="text-burgundy hover:underline"
              to="/administration/roles"
            >
              Roles and Permissions
            </Link>
            <span className="text-muted">
              {" "}
              — read-only role vs permission matrix
            </span>
          </li>
        ) : null}
        {can("settings.view") ? (
          <li>
            <Link
              className="text-burgundy hover:underline"
              to="/administration/settings"
            >
              Settings
            </Link>
            <span className="text-muted">
              {" "}
              — company, billing, receivables, payments, security
            </span>
          </li>
        ) : null}
        {can("audit.view") ? (
          <li>
            <Link
              className="text-burgundy hover:underline"
              to="/administration/audit"
            >
              Audit Log
            </Link>
            <span className="text-muted">
              {" "}
              — read-only activity trail with filters and export
            </span>
          </li>
        ) : null}
        {can("backup.create") ? (
          <li>
            <Link
              className="text-burgundy hover:underline"
              to="/administration/backups"
            >
              System & Backup
            </Link>
            <span className="text-muted">
              {" "}
              — create, verify, restore database backups
            </span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
