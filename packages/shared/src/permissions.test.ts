import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  ROLE_PERMISSION_MATRIX,
  ROLES,
  type PermissionCode,
} from "./permissions.js";

describe("ROLE_PERMISSION_MATRIX (SPEC 3.1 / 4.4)", () => {
  it("covers every SPEC role", () => {
    expect([...ROLES]).toEqual([
      "Owner",
      "Administrator",
      "Cashier",
      "Collection Supervisor",
      "Collector",
      "Auditor",
      "Technician",
      "Viewer",
    ]);
  });

  it("only grants known permission codes", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const role of ROLES) {
      for (const code of ROLE_PERMISSION_MATRIX[role]) {
        expect(known.has(code)).toBe(true);
      }
    }
  });

  it("gives Owner every permission including backup.restore", () => {
    expect(ROLE_PERMISSION_MATRIX.Owner).toEqual([...PERMISSIONS]);
    expect(ROLE_PERMISSION_MATRIX.Owner).toContain("backup.restore");
    expect(ROLE_PERMISSION_MATRIX.Owner).toContain("user.manage");
  });

  it("keeps Administrator operational (no users/config/audit/backup)", () => {
    const admin = new Set(ROLE_PERMISSION_MATRIX.Administrator);
    expect(admin.has("billing.generate")).toBe(true);
    expect(admin.has("collection.reconcile")).toBe(true);
    expect(admin.has("report.export")).toBe(true);
    for (const denied of [
      "user.manage",
      "role.manage",
      "settings.manage",
      "backup.create",
      "backup.restore",
      "audit.view",
    ] as PermissionCode[]) {
      expect(admin.has(denied)).toBe(false);
    }
  });

  it("gives Cashier payment + GCash verify without admin rights", () => {
    const cashier = ROLE_PERMISSION_MATRIX.Cashier;
    expect(cashier).toEqual(
      expect.arrayContaining([
        "subscriber.view",
        "payment.create",
        "gcash.verify",
        "gcash.reject",
        "receivable.view",
      ]),
    );
    expect(cashier).not.toContain("user.manage");
    expect(cashier).not.toContain("billing.generate");
  });

  it("keeps Technician service-scoped only", () => {
    expect(ROLE_PERMISSION_MATRIX.Technician).toEqual([
      "subscriber.view",
      "service.manage",
    ]);
  });

  it("keeps Viewer mutation-free", () => {
    const viewer = ROLE_PERMISSION_MATRIX.Viewer;
    expect(viewer).toContain("report.view");
    expect(viewer.some((p) => p.endsWith(".create") || p.endsWith(".manage"))).toBe(
      false,
    );
  });
});
