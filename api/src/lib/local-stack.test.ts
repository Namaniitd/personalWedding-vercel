import { afterEach, describe, expect, it, vi } from "vitest";

import { getDatabasePool, resetDatabaseRsvpPoolForTest } from "./database-rsvps";
import { getInvitationStoreMode } from "./invitation-mode";
import { isLocalStackDatabase, isLocalStackPublicOrigin } from "./local-stack";

const localDatabaseUrl = "postgresql://user:password@db:5432/shaadi";

describe("built local stack boundary", () => {
  afterEach(async () => {
    await resetDatabaseRsvpPoolForTest();
    vi.unstubAllEnvs();
  });

  function configureLocalStack(origin = "http://127.0.0.1:3000", databaseUrl = localDatabaseUrl) {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOCAL_STACK_MODE", "1");
    vi.stubEnv("PUBLIC_APP_ORIGIN", origin);
    vi.stubEnv("DATABASE_URL", databaseUrl);
    vi.stubEnv("DATABASE_INVITATION_TOKEN_PEPPER", "test-invitation-pepper");
    vi.stubEnv("DATABASE_ENTRY_PASS_TOKEN_PEPPER", "test-entry-pass-pepper");
    vi.stubEnv("SUPABASE_URL", undefined);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", undefined);
    vi.stubEnv("INVITATION_TOKEN_PEPPER", undefined);
    vi.stubEnv("ENTRY_PASS_TOKEN_PEPPER", undefined);
    vi.stubEnv("PGSSLMODE", undefined);
  }

  it.each([3000, 3001, 3002])("accepts loopback web port %s with only the db service host", (port) => {
    configureLocalStack(`http://127.0.0.1:${port}`);
    expect(isLocalStackPublicOrigin()).toBe(true);
    expect(isLocalStackDatabase()).toBe(true);
    expect(getInvitationStoreMode()).toBe("database");
    expect(getDatabasePool()).toBeDefined();
  });

  it.each([
    "http://127.0.0.1:3003", "http://0.0.0.0:3002", "http://localhost:3002",
    "http://127.0.0.1.evil.test:3002", "http://127.0.0.1:3002/", "http://127.0.0.1:3002?local=1"
  ])("rejects unapproved or lookalike local origins: %s", (origin) => {
    configureLocalStack(origin);
    expect(isLocalStackPublicOrigin()).toBe(false);
    expect(isLocalStackDatabase()).toBe(false);
    expect(getInvitationStoreMode()).toBe("disabled");
  });

  it("rejects external origins and lookalike database hosts even with the flag", () => {
    configureLocalStack("http://0.0.0.0:3000");
    expect(isLocalStackDatabase()).toBe(false);
    expect(getInvitationStoreMode()).toBe("disabled");

    configureLocalStack("http://127.0.0.1:3000", "postgresql://user:password@db.evil.test:5432/shaadi");
    expect(isLocalStackDatabase()).toBe(false);
    expect(getInvitationStoreMode()).toBe("disabled");

    configureLocalStack("http://127.0.0.1:3000", "postgresql://user:password@db:5432/shaadi?sslmode=disable");
    expect(isLocalStackDatabase()).toBe(false);
    expect(getInvitationStoreMode()).toBe("disabled");
  });

  it("never permits the plaintext db host when the local flag is absent", () => {
    configureLocalStack();
    vi.stubEnv("LOCAL_STACK_MODE", undefined);
    expect(isLocalStackDatabase()).toBe(false);
    expect(getInvitationStoreMode()).toBe("disabled");
  });
});
