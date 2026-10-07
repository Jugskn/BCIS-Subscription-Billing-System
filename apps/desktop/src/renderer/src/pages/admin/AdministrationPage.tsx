import { Link } from "react-router-dom";

export function AdministrationPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Administration</h1>
      <p className="mt-2 text-sm text-muted">
        System administration tools for users, settings, and backups.
      </p>
      <ul className="mt-6 space-y-2 text-sm">
        <li>
          <Link className="text-burgundy hover:underline" to="/administration/users">
            Users
          </Link>
          <span className="text-muted"> — list, create, deactivate, assign roles</span>
        </li>
        <li className="text-muted">Settings — coming later</li>
        <li className="text-muted">Backups — coming later</li>
      </ul>
    </div>
  );
}
