/**
 * AT-09 concurrency harness: 3 users × 20 rounds of parallel payment/ledger/preview.
 * Run: pnpm test:concurrency
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { buildApp } from "../app.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
config({ path: resolve(root, ".env") });

const ROUNDS = 20;

async function login(
  app: Awaited<ReturnType<typeof buildApp>>,
  username: string,
  password: string,
) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { username, password },
  });
  if (res.statusCode !== 200) {
    throw new Error(`Login failed for ${username}: ${res.statusCode}`);
  }
  return (res.json() as { token: string }).token;
}

async function main() {
  const cfg = loadConfig();
  const app = await buildApp(cfg);
  await app.ready();

  const ownerUser = process.env.SEED_OWNER_USERNAME ?? "owner";
  const ownerPass = process.env.SEED_OWNER_PASSWORD!;
  const ownerToken = await login(app, ownerUser, ownerPass);

  // Prefer demo users when present; else create ephemeral tokens from owner ops
  const users: { label: string; token: string }[] = [
    { label: "owner", token: ownerToken },
  ];
  for (const u of [
    { username: "cashier_demo", password: "DemoCashier123!" },
    { username: "admin_demo", password: "DemoAdmin123!" },
  ]) {
    try {
      users.push({
        label: u.username,
        token: await login(app, u.username, u.password),
      });
    } catch {
      users.push({ label: `${u.username}-fallback`, token: ownerToken });
    }
  }

  // Ensure 3 distinct subscribers with open balances
  const planList = await app.inject({
    method: "GET",
    url: "/service-plans?page=1&pageSize=1",
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  const planId = (planList.json() as { items: { id: string }[] }).items[0]!.id;

  const subscriberIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const sub = await app.inject({
      method: "POST",
      url: "/subscribers",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        fullName: `Concurrency Sub ${Date.now()}-${i}`,
        address: `Concurrency ${i}`,
        dueDay: 12,
      },
    });
    const subId = (sub.json() as { id: string }).id;
    await app.inject({
      method: "POST",
      url: "/service-accounts",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        subscriberId: subId,
        servicePlanId: planId,
        installationAddress: `Concurrency ${i}`,
        activationDate: "2025-01-01",
        billingStartDate: "2025-01-01",
        dueDay: 12,
      },
    });
    subscriberIds.push(subId);
  }

  const period = `2024-${String((Date.now() % 12) + 1).padStart(2, "0")}`;
  await app.inject({
    method: "POST",
    url: "/billing/generate",
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { billingPeriod: period },
  });

  const receiptNumbers = new Set<string>();
  let failures = 0;

  for (let round = 0; round < ROUNDS; round++) {
    const tasks = users.map(async (u, idx) => {
      const subId = subscriberIds[idx]!;
      const pay = await app.inject({
        method: "POST",
        url: "/payments",
        headers: { authorization: `Bearer ${u.token}` },
        payload: {
          subscriberId: subId,
          amount: "50.00",
          method: "Cash",
          idempotencyKey: `conc-${u.label}-${round}-${Date.now()}`,
        },
      });
      if (pay.statusCode >= 400) {
        failures += 1;
        console.error("payment fail", u.label, pay.statusCode, pay.body);
        return;
      }
      const body = pay.json() as {
        receipt?: { receiptNumber: string };
      };
      const rn = body.receipt?.receiptNumber;
      if (rn) {
        if (receiptNumbers.has(rn)) {
          failures += 1;
          console.error("duplicate receipt", rn);
        }
        receiptNumbers.add(rn);
      }

      const ledger = await app.inject({
        method: "GET",
        url: `/subscribers/${subId}/ledger?page=1&pageSize=20`,
        headers: { authorization: `Bearer ${u.token}` },
      });
      if (ledger.statusCode >= 400) failures += 1;

      const preview = await app.inject({
        method: "POST",
        url: "/billing/preview",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { billingPeriod: period },
      });
      if (preview.statusCode >= 400) failures += 1;
    });
    await Promise.all(tasks);
  }

  await app.close();

  if (failures > 0) {
    console.error(`AT-09 FAILED: ${failures} failed requests or duplicates`);
    process.exit(1);
  }
  console.log(
    `AT-09 PASS: ${ROUNDS} rounds × ${users.length} users; ${receiptNumbers.size} unique receipts`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
