export const PERMISSIONS = [
  "subscriber.view",
  "subscriber.create",
  "subscriber.update",
  "subscriber.deactivate",
  "billing.generate",
  "billing.void",
  "payment.create",
  "payment.reverse",
  "payment.allocate_manual",
  "gcash.verify",
  "gcash.reject",
  "collection.create",
  "collection.reconcile",
  "collection.close",
  "receivable.view",
  "service.manage",
  "report.view",
  "report.export",
  "user.manage",
  "role.manage",
  "settings.view",
  "settings.manage",
  "backup.create",
  "backup.restore",
  "audit.view",
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number];

export const ROLES = [
  "Owner",
  "Administrator",
  "Cashier",
  "Collection Supervisor",
  "Collector",
  "Auditor",
  "Technician",
  "Viewer",
] as const;

export type RoleName = (typeof ROLES)[number];

const ALL = [...PERMISSIONS] as PermissionCode[];

/** Operational admin scope (SPEC 3.1 Administrator): no users/settings.manage/audit/backup. */
const ADMINISTRATOR: PermissionCode[] = [
  "subscriber.view",
  "subscriber.create",
  "subscriber.update",
  "subscriber.deactivate",
  "billing.generate",
  "billing.void",
  "payment.create",
  "payment.reverse",
  "payment.allocate_manual",
  "gcash.verify",
  "gcash.reject",
  "collection.create",
  "collection.reconcile",
  "collection.close",
  "receivable.view",
  "service.manage",
  "report.view",
  "report.export",
  "settings.view",
];

/** Default role → permission matrix used by seed and docs (SPEC 3.1 + 4.4). */
export const ROLE_PERMISSION_MATRIX: Record<RoleName, PermissionCode[]> = {
  Owner: ALL,
  Administrator: ADMINISTRATOR,
  Cashier: [
    "subscriber.view",
    "payment.create",
    "gcash.verify",
    "gcash.reject",
    "receivable.view",
  ],
  "Collection Supervisor": [
    "subscriber.view",
    "payment.create",
    "collection.create",
    "collection.reconcile",
    "collection.close",
    "receivable.view",
    "report.view",
    "report.export",
  ],
  /** Field staff assigned to subscribers/areas (SPEC demo "Collectors"). */
  Collector: ["subscriber.view", "receivable.view"],
  Auditor: [
    "subscriber.view",
    "receivable.view",
    "report.view",
    "report.export",
    "audit.view",
    "settings.view",
  ],
  Technician: ["subscriber.view", "service.manage"],
  Viewer: ["subscriber.view", "receivable.view", "report.view"],
};

export function hasPermission(
  granted: readonly string[],
  required: PermissionCode,
): boolean {
  return granted.includes(required);
}
