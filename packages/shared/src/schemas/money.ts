import { z } from "zod";
import { pesosToCentavos } from "../money.js";

/** Non-negative centavos as decimal string (bigint-safe over JSON). */
export const centavosStringSchema = z
  .string()
  .regex(/^\d+$/, "Amount must be a whole number of centavos.");

/** Accept peso string (e.g. "999.00") or centavos string; output centavos bigint. */
export const moneyInputSchema = z
  .union([z.string(), z.number()])
  .transform((val, ctx) => {
    try {
      const centavos = pesosToCentavos(val);
      if (centavos < 0n) {
        ctx.addIssue({ code: "custom", message: "Amount cannot be negative." });
        return z.NEVER;
      }
      return centavos;
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid money amount." });
      return z.NEVER;
    }
  });

export function centavosToString(centavos: bigint): string {
  return centavos.toString();
}
