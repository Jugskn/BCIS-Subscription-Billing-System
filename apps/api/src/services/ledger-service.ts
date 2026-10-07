import { and, count, eq, gte, lte, sql } from "drizzle-orm";
import { ledgerEntries, subscribers, type Database } from "@bcis/db";
import { centavosToString, computeRunningBalances } from "@bcis/shared";
import { AppError } from "../lib/errors.js";

export async function listSubscriberLedger(
  db: Database["db"],
  subscriberId: string,
  query: {
    page: number;
    pageSize: number;
    fromDate?: string;
    toDate?: string;
  },
) {
  const [sub] = await db
    .select({ id: subscribers.id })
    .from(subscribers)
    .where(eq(subscribers.id, subscriberId))
    .limit(1);
  if (!sub) throw new AppError(404, "NOT_FOUND", "Subscriber not found.");

  const filters = [eq(ledgerEntries.subscriberId, subscriberId)];
  if (query.fromDate) filters.push(gte(ledgerEntries.entryDate, query.fromDate));
  if (query.toDate) filters.push(lte(ledgerEntries.entryDate, query.toDate));
  const where = and(...filters);

  const allRows = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.subscriberId, subscriberId))
    .orderBy(ledgerEntries.entryDate, ledgerEntries.id);

  const filtered = allRows.filter((row) => {
    if (query.fromDate && row.entryDate < query.fromDate) return false;
    if (query.toDate && row.entryDate > query.toDate) return false;
    return true;
  });

  const withBalances = computeRunningBalances(
    allRows.map((row) => ({
      id: row.id,
      entryDate: row.entryDate,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      description: row.description,
      debitCentavos: row.debitCentavos,
      creditCentavos: row.creditCentavos,
    })),
  );

  const balanceById = new Map(withBalances.map((e) => [e.id, e.balanceCentavos]));

  const [totalRow] = await db
    .select({ total: count() })
    .from(ledgerEntries)
    .where(where);

  const offset = (query.page - 1) * query.pageSize;
  const pageRows = filtered.slice(offset, offset + query.pageSize);

  return {
    items: pageRows.map((row) => ({
      id: row.id,
      entryDate: row.entryDate,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      description: row.description,
      debitCentavos: centavosToString(row.debitCentavos),
      creditCentavos: centavosToString(row.creditCentavos),
      balanceCentavos: centavosToString(balanceById.get(row.id) ?? 0n),
      serviceAccountId: row.serviceAccountId,
    })),
    page: query.page,
    pageSize: query.pageSize,
    total: totalRow?.total ?? filtered.length,
  };
}

export async function getStatementOfAccount(
  db: Database["db"],
  subscriberId: string,
  fromDate: string,
  toDate: string,
) {
  const [sub] = await db
    .select()
    .from(subscribers)
    .where(eq(subscribers.id, subscriberId))
    .limit(1);
  if (!sub) throw new AppError(404, "NOT_FOUND", "Subscriber not found.");

  const allRows = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.subscriberId, subscriberId))
    .orderBy(ledgerEntries.entryDate, ledgerEntries.id);

  const withBalances = computeRunningBalances(
    allRows.map((row) => ({
      id: row.id,
      entryDate: row.entryDate,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      description: row.description,
      debitCentavos: row.debitCentavos,
      creditCentavos: row.creditCentavos,
    })),
  );

  const beforeRange = withBalances.filter((e) => e.entryDate < fromDate);
  const openingBalanceCentavos =
    beforeRange.length > 0
      ? beforeRange[beforeRange.length - 1]!.balanceCentavos
      : 0n;

  const inRange = withBalances.filter(
    (e) => e.entryDate >= fromDate && e.entryDate <= toDate,
  );

  const closingBalanceCentavos =
    inRange.length > 0
      ? inRange[inRange.length - 1]!.balanceCentavos
      : openingBalanceCentavos;

  return {
    subscriberId: sub.id,
    subscriberName: sub.fullName,
    accountNumber: sub.accountNumber,
    fromDate,
    toDate,
    openingBalanceCentavos: centavosToString(openingBalanceCentavos),
    closingBalanceCentavos: centavosToString(closingBalanceCentavos),
    entries: inRange.map((e) => ({
      id: e.id,
      entryDate: e.entryDate,
      referenceType: e.referenceType,
      referenceId: e.referenceId,
      description: e.description,
      debitCentavos: centavosToString(e.debitCentavos),
      creditCentavos: centavosToString(e.creditCentavos),
      balanceCentavos: centavosToString(e.balanceCentavos),
      serviceAccountId: allRows.find((r) => r.id === e.id)?.serviceAccountId ?? null,
    })),
  };
}

/** SQL window-function running balance for large ledgers (used when full scan needed). */
export async function ledgerRunningBalanceSql(
  db: Database["db"],
  subscriberId: string,
): Promise<bigint> {
  const result = await db.execute(sql`
    SELECT balance_centavos FROM (
      SELECT
        (SUM(debit_centavos - credit_centavos) OVER (
          ORDER BY entry_date, id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ))::bigint AS balance_centavos
      FROM ledger_entries
      WHERE subscriber_id = ${subscriberId}
    ) t
    ORDER BY balance_centavos DESC
    LIMIT 1
  `);
  const rows = result as unknown as Array<{ balance_centavos: string | bigint }>;
  const val = rows[0]?.balance_centavos ?? 0n;
  return typeof val === "bigint" ? val : BigInt(val);
}
