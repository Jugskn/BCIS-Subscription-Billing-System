/** All money values are integer centavos (bigint). Never use floats for money. */

export function pesosToCentavos(pesos: string | number): bigint {
  const normalized =
    typeof pesos === "number" ? pesos.toFixed(2) : pesos.trim();
  const match = /^(-?)(\d+)(?:\.(\d{0,2}))?$/.exec(normalized);
  if (!match) {
    throw new Error(`Invalid peso amount: ${pesos}`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2] ?? "0");
  const frac = (match[3] ?? "").padEnd(2, "0").slice(0, 2);
  return sign * (whole * 100n + BigInt(frac));
}

export function formatCentavos(
  centavos: bigint,
  options?: { currency?: string; locale?: string },
): string {
  const currency = options?.currency ?? "PHP";
  const locale = options?.locale ?? "en-PH";
  const negative = centavos < 0n;
  const abs = negative ? -centavos : centavos;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  const number = `${negative ? "-" : ""}${whole.toString()}.${frac}`;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(number));
}

export function addCentavos(...amounts: bigint[]): bigint {
  return amounts.reduce((sum, n) => sum + n, 0n);
}
