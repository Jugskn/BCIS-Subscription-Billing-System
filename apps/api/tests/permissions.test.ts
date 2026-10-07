import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, ensureCashierUser } from "./helpers.js";

/**
 * AT-10 style: a Cashier authenticated session cannot call user.manage routes.
 */
describe("AT-10 permission enforcement", () => {
  let app: FastifyInstance;
  let cashierToken: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    const cashier = await ensureCashierUser();
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: cashier.username, password: cashier.password },
    });
    expect(login.statusCode).toBe(200);
    cashierToken = (login.json() as { token: string }).token;
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 403 when cashier lists users", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/users",
      headers: { authorization: `Bearer ${cashierToken}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("returns 403 when cashier creates a user", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/users",
      headers: { authorization: `Bearer ${cashierToken}` },
      payload: {
        username: "should_fail",
        password: "Password123!",
        fullName: "Should Fail",
        roleNames: ["Viewer"],
      },
    });

    expect(res.statusCode).toBe(403);
  });
});
