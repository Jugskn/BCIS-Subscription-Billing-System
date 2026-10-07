export type LedgerEntryInput = {
  id: string;
  entryDate: string;
  referenceType: string;
  referenceId: string;
  description: string;
  debitCentavos: bigint;
  creditCentavos: bigint;
};

export type LedgerEntryWithBalance = LedgerEntryInput & {
  balanceCentavos: bigint;
};

/**
 * Reproducible running balance: chronological by date then id.
 * Balance = prior balance + debit - credit (debit increases what subscriber owes).
 */
export function computeRunningBalances(
  entries: LedgerEntryInput[],
): LedgerEntryWithBalance[] {
  const sorted = [...entries].sort((a, b) => {
    const dateCmp = a.entryDate.localeCompare(b.entryDate);
    if (dateCmp !== 0) return dateCmp;
    return a.id.localeCompare(b.id);
  });

  let running = 0n;
  return sorted.map((entry) => {
    running += entry.debitCentavos - entry.creditCentavos;
    return { ...entry, balanceCentavos: running };
  });
}

export function ledgerBalanceAt(
  entries: LedgerEntryInput[],
  asOfDate: string,
): bigint {
  const filtered = entries.filter((e) => e.entryDate <= asOfDate);
  const withBalances = computeRunningBalances(filtered);
  if (withBalances.length === 0) return 0n;
  return withBalances[withBalances.length - 1]!.balanceCentavos;
}
