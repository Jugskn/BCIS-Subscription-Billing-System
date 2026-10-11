import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp } from "./helpers.js";

describe("auth login", () => {
  let app: FastifyInstance;
  const ownerUsername = process.env.SEED_OWNER_USERNAME ?? "owner";
  const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? "CHANGE_ME";

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it("logs in with seeded owner credentials", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: ownerUsername, password: ownerPassword },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      token: string;
      user: { username: string; permissions: string[] };
    };
    expect(body.token).toBeTruthy();
    expect(body.user.username).toBe(ownerUsername);
    expect(body.user.permissions).toContain("user.manage");
  });

  it("rejects bad passwords", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: ownerUsername, password: "wrong-password" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toMatch(/invalid/i);
  });

  it("returns the authenticated session profile from /auth/me", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: ownerUsername, password: ownerPassword },
    });
    const loginBody = login.json() as {
      token: string;
      user: { id: string; fullName: string; roles: string[] };
    };

    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${loginBody.token}` },
    });

    expect(me.statusCode).toBe(200);
    expect(me.json().user).toEqual(loginBody.user);
  });

  it("rejects unauthenticated /auth/me requests", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/me" });
    expect(res.statusCode).toBe(401);
  });
});
