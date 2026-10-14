import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { fetchWithTimeout } from "./invitations";
import { getInvitationStoreMode, isDatabaseCoordinatorMode } from "./invitation-mode";

function listenOnLoopback(server: Server) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No loopback port was assigned."));
      resolve(address.port);
    });
  });
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

const environmentKeys = [
  "NODE_ENV",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "INVITATION_TOKEN_PEPPER",
  "ENTRY_PASS_TOKEN_PEPPER",
  "DATABASE_URL",
  "DATABASE_INVITATION_TOKEN_PEPPER",
  "DATABASE_ENTRY_PASS_TOKEN_PEPPER",
  "PUBLIC_APP_ORIGIN",
  "NODE_TLS_REJECT_UNAUTHORIZED"
] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
const mutableEnvironment = process.env as Record<string, string | undefined>;

function setEnvironment(key: (typeof environmentKeys)[number], value: string | undefined) {
  if (value === undefined) delete mutableEnvironment[key];
  else mutableEnvironment[key] = value;
}

function clearStoreEnvironment() {
  setEnvironment("SUPABASE_URL", undefined);
  setEnvironment("SUPABASE_SERVICE_ROLE_KEY", undefined);
  setEnvironment("INVITATION_TOKEN_PEPPER", undefined);
  setEnvironment("ENTRY_PASS_TOKEN_PEPPER", undefined);
  setEnvironment("DATABASE_URL", undefined);
  setEnvironment("DATABASE_INVITATION_TOKEN_PEPPER", undefined);
  setEnvironment("DATABASE_ENTRY_PASS_TOKEN_PEPPER", undefined);
  setEnvironment("PUBLIC_APP_ORIGIN", undefined);
  setEnvironment("NODE_TLS_REJECT_UNAUTHORIZED", undefined);
}

afterEach(() => {
  for (const key of environmentKeys) setEnvironment(key, originalEnvironment.get(key));
});

describe("invitation store mode", () => {
  it("fails closed for missing or partial hosted credentials in production", () => {
    setEnvironment("NODE_ENV", "production");
    clearStoreEnvironment();
    expect(getInvitationStoreMode()).toBe("disabled");

    setEnvironment("SUPABASE_URL", "https://example.supabase.co");
    expect(getInvitationStoreMode()).toBe("disabled");
  });

  it("never enables an in-memory or fixture-backed invitation fallback", () => {
    setEnvironment("NODE_ENV", "development");
    clearStoreEnvironment();
    expect(getInvitationStoreMode()).toBe("disabled");
  });

  it("enables the coordinator with a complete database configuration", () => {
    setEnvironment("NODE_ENV", "development");
    clearStoreEnvironment();
    setEnvironment("DATABASE_URL", "postgresql://user:password@127.0.0.1/shaadi");
    setEnvironment("DATABASE_INVITATION_TOKEN_PEPPER", "database-test-pepper");
    setEnvironment("DATABASE_ENTRY_PASS_TOKEN_PEPPER", "entry-pass-test-pepper");
    expect(getInvitationStoreMode()).toBe("database");
    expect(isDatabaseCoordinatorMode()).toBe(true);
  });

  it("requires all direct-database credentials", () => {
    setEnvironment("NODE_ENV", "development");
    clearStoreEnvironment();
    setEnvironment("DATABASE_URL", "postgresql://user:password@127.0.0.1/shaadi");
    setEnvironment("DATABASE_INVITATION_TOKEN_PEPPER", "database-test-pepper");
    expect(getInvitationStoreMode()).toBe("disabled");

    setEnvironment("DATABASE_ENTRY_PASS_TOKEN_PEPPER", "entry-pass-test-pepper");
    expect(getInvitationStoreMode()).toBe("database");
  });

  it("requires canonical origin, verify-full TLS, and no global TLS bypass in production", () => {
    setEnvironment("NODE_ENV", "production");
    clearStoreEnvironment();
    setEnvironment("DATABASE_URL", "postgresql://user:password@database.example/shaadi?sslmode=require");
    setEnvironment("DATABASE_INVITATION_TOKEN_PEPPER", "database-test-pepper");
    setEnvironment("DATABASE_ENTRY_PASS_TOKEN_PEPPER", "entry-pass-test-pepper");
    expect(getInvitationStoreMode()).toBe("disabled");

    setEnvironment("PUBLIC_APP_ORIGIN", "https://invite.example.in");
    expect(getInvitationStoreMode()).toBe("disabled");

    setEnvironment("DATABASE_URL", "postgresql://user:password@database.example/shaadi?sslmode=verify-full");
    expect(getInvitationStoreMode()).toBe("database");
    expect(isDatabaseCoordinatorMode()).toBe(true);

    setEnvironment("NODE_TLS_REJECT_UNAUTHORIZED", "0");
    expect(getInvitationStoreMode()).toBe("disabled");
  });

  it("accepts only a canonical HTTPS Supabase endpoint and rejects ambiguous backend configuration", () => {
    setEnvironment("NODE_ENV", "development");
    clearStoreEnvironment();
    setEnvironment("DATABASE_URL", "postgresql://user:password@127.0.0.1/shaadi");
    setEnvironment("DATABASE_INVITATION_TOKEN_PEPPER", "database-test-pepper");
    setEnvironment("DATABASE_ENTRY_PASS_TOKEN_PEPPER", "entry-pass-test-pepper");
    setEnvironment("SUPABASE_URL", "https://example.supabase.co");
    expect(getInvitationStoreMode()).toBe("disabled");

    setEnvironment("SUPABASE_SERVICE_ROLE_KEY", "server-only-key");
    setEnvironment("INVITATION_TOKEN_PEPPER", "installation-pepper");
    expect(getInvitationStoreMode()).toBe("disabled");

    clearStoreEnvironment();
    setEnvironment("SUPABASE_URL", "http://example.supabase.co");
    setEnvironment("SUPABASE_SERVICE_ROLE_KEY", "server-only-key");
    setEnvironment("INVITATION_TOKEN_PEPPER", "installation-pepper");
    expect(getInvitationStoreMode()).toBe("disabled");

    setEnvironment("SUPABASE_URL", "https://example.supabase.co");
    expect(getInvitationStoreMode()).toBe("disabled");
    setEnvironment("ENTRY_PASS_TOKEN_PEPPER", "hosted-entry-pass-test-pepper");
    expect(getInvitationStoreMode()).toBe("hosted");
  });
});

describe("hosted service-key transport", () => {
  it("rejects a redirect before the Supabase apikey header reaches another origin", async () => {
    let destinationRequests = 0;
    const destination = createServer((_request, response) => {
      destinationRequests += 1;
      response.end("ok");
    });
    const destinationPort = await listenOnLoopback(destination);
    const redirect = createServer((_request, response) => {
      response.writeHead(302, { Location: `http://127.0.0.1:${destinationPort}/` });
      response.end();
    });
    try {
      const redirectPort = await listenOnLoopback(redirect);
      await expect(fetchWithTimeout(`http://127.0.0.1:${redirectPort}/`, {
        headers: { apikey: "synthetic-service-key" }
      })).rejects.toThrow();
      expect(destinationRequests).toBe(0);
    } finally {
      await Promise.all([closeServer(redirect), closeServer(destination)]);
    }
  });
});
