import { afterEach, describe, expect, it, vi } from "vitest";

import {
  databaseEntryAttendanceForEvent,
  databaseEntryPassTokenDigest,
  deriveDatabaseEntryPassToken,
  hasDatabaseEntryPassEligibility
} from "./database-entry-passes";

describe("database entry-pass credential helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("derives a stable opaque pass that rotates with its non-secret version", () => {
    vi.stubEnv("DATABASE_ENTRY_PASS_TOKEN_PEPPER", "entry-pass-test-pepper");
    const invitationToken = "N2p3WqBLF98cGVqHAOQm9N8w6B8LhR_Sd-CpT9kV1Ys";
    const first = deriveDatabaseEntryPassToken(invitationToken, "2d8f3ea1-d941-443e-9e56-663a339cc1d2");
    const repeat = deriveDatabaseEntryPassToken(invitationToken, "2d8f3ea1-d941-443e-9e56-663a339cc1d2");
    const rotated = deriveDatabaseEntryPassToken(invitationToken, "bdb1054e-49eb-463a-9de9-14cb31c74434");

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(repeat).toBe(first);
    expect(rotated).not.toBe(first);
    expect(first).not.toContain(invitationToken);
    expect(databaseEntryPassTokenDigest(first)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("requires a dedicated database entry-pass pepper", () => {
    vi.stubEnv("DATABASE_INVITATION_TOKEN_PEPPER", "invitation-pepper");
    vi.stubEnv("DATABASE_ENTRY_PASS_TOKEN_PEPPER", "entry-pass-pepper");
    const dedicated = deriveDatabaseEntryPassToken("N2p3WqBLF98cGVqHAOQm9N8w6B8LhR_Sd-CpT9kV1Ys", "2d8f3ea1-d941-443e-9e56-663a339cc1d2");

    vi.stubEnv("DATABASE_ENTRY_PASS_TOKEN_PEPPER", "");
    expect(() => deriveDatabaseEntryPassToken("N2p3WqBLF98cGVqHAOQm9N8w6B8LhR_Sd-CpT9kV1Ys", "2d8f3ea1-d941-443e-9e56-663a339cc1d2"))
      .toThrow("DATABASE_ENTRY_PASS_TOKEN_PEPPER");
    expect(dedicated).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("requires an attending RSVP with a selected event and resolves event-specific counts", () => {
    const attendances = [
      { eventId: "sangeet", attending: true, adults: 2, children: 1 },
      { eventId: "wedding", attending: false, adults: 0, children: 0 }
    ];
    expect(hasDatabaseEntryPassEligibility("attending", attendances)).toBe(true);
    expect(hasDatabaseEntryPassEligibility("confirming", attendances)).toBe(false);
    expect(databaseEntryAttendanceForEvent("attending", attendances, "sangeet")).toEqual({ adults: 2, children: 1 });
    expect(databaseEntryAttendanceForEvent("attending", attendances, "wedding")).toBeNull();
    expect(databaseEntryAttendanceForEvent("attending", [{ eventId: "sangeet", attending: true, adults: 0, children: 0 }], "sangeet")).toBeNull();
  });
});
