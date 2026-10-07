import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp } from "./helpers.js";

const DEV_ORIGIN = "http://127.0.0.1:5173";
const ALLOWED_METHODS = "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS";

describe("CORS preflight", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    { method: "PATCH", path: "/subscribers/00000000-0000-0000-0000-000000000001" },
    { method: "PUT", path: "/collection-areas/00000000-0000-0000-0000-000000000001" },
    { method: "DELETE", path: "/collection-areas/00000000-0000-0000-0000-000000000001" },
  ] as const)(
    "OPTIONS for $method returns Access-Control-Allow-Methods including $method",
    async ({ method, path }) => {
      const res = await app.inject({
        method: "OPTIONS",
        url: path,
        headers: {
          Origin: DEV_ORIGIN,
          "Access-Control-Request-Method": method,
          "Access-Control-Request-Headers": "content-type,authorization",
        },
      });

      expect(res.statusCode).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe(DEV_ORIGIN);
      const allowMethods = String(res.headers["access-control-allow-methods"] ?? "");
      expect(allowMethods).toBe(ALLOWED_METHODS);
      expect(allowMethods).toMatch(new RegExp(`\\b${method}\\b`));
      // Preflight must not require a token (no 401).
      expect(res.headers["access-control-allow-headers"]).toMatch(/authorization/i);
    },
  );
});
