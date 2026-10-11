import { describe, expect, it } from "vitest";
import {
  createSubscriberSchema,
  formatPhilippineMobile,
  normalizePhilippineMobile,
} from "./subscribers.js";

const validSubscriber = {
  fullName: "Maria Lourdes Abad Villanueva",
  address: "Purok 1, Barangay Casisang, Malaybalay City, Bukidnon",
  dueDay: 15,
};

describe("Philippine mobile numbers", () => {
  it("normalizes 09XX input to E.164 storage format", () => {
    expect(normalizePhilippineMobile("0917 123 4567")).toBe("+639171234567");
    expect(
      createSubscriberSchema.parse({
        ...validSubscriber,
        contactPhone: "0917-123-4567",
      }).contactPhone,
    ).toBe("+639171234567");
  });

  it("rejects invalid mobile numbers", () => {
    expect(
      createSubscriberSchema.safeParse({
        ...validSubscriber,
        contactPhone: "12345",
      }).success,
    ).toBe(false);
  });

  it("formats stored numbers for display", () => {
    expect(formatPhilippineMobile("+639171234567")).toBe("+63 917 123 4567");
  });
});

describe("createSubscriberSchema service plans", () => {
  it("defaults servicePlanIds to an empty array", () => {
    expect(createSubscriberSchema.parse(validSubscriber).servicePlanIds).toEqual([]);
  });

  it("accepts selected service plan ids", () => {
    const planId = "11111111-1111-4111-8111-111111111111";
    expect(
      createSubscriberSchema.parse({
        ...validSubscriber,
        servicePlanIds: [planId],
      }).servicePlanIds,
    ).toEqual([planId]);
  });
});
