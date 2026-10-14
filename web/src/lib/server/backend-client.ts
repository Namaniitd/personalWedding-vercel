import type {
  DatabaseCoordinatorInvitation,
  DatabaseInvitationIssuerOptions,
  DatabaseWeddingContentSnapshot,
  ResolvedInvitation
} from "@/lib/types";
import { isLocalStackPublicOrigin } from "@/lib/server/local-stack";

export type BackendStatus = {
  mode: "database" | "hosted" | "disabled";
  coordinatorAvailable: boolean;
};

export type CoordinatorWorkspace = {
  issuerOptions: DatabaseInvitationIssuerOptions;
  invitations: DatabaseCoordinatorInvitation[];
};

export class BackendUnavailableError extends Error {
  constructor() {
    super("The private application service is unavailable.");
    this.name = "BackendUnavailableError";
  }
}

type BackendPath =
  | "/v1/readyz"
  | "/v1/status"
  | "/v1/security/rate-limit"
  | "/v1/security/coordinator-session"
  | "/v1/invitations/resolve"
  | "/v1/rsvp"
  | "/v1/coordinator/workspace"
  | "/v1/coordinator/rsvp"
  | "/v1/coordinator/content"
  | "/v1/coordinator/invitations"
  | "/v1/coordinator/invitations/revoke"
  | "/v1/coordinator/invitations/rsvp/delete"
  | "/v1/coordinator/check-in";

function configuredBackendOrigin() {
  const supplied = process.env.BACKEND_URL;
  if (process.env.VERCEL === "1") {
    // Pin one operator-configured Vercel project origin. The browser/request
    // never chooses the destination of the shared service credential.
    try {
      if (!supplied || supplied.length > 256) throw new BackendUnavailableError();
      const parsed = new URL(supplied);
      if (parsed.protocol !== "https:"
        || parsed.port
        || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(parsed.hostname)
        || supplied !== parsed.origin) throw new BackendUnavailableError();
      return parsed.origin;
    } catch {
      throw new BackendUnavailableError();
    }
  }
  const expected = process.env.NODE_ENV === "production" && isLocalStackPublicOrigin()
    ? "http://api:4000"
    : "http://127.0.0.1:4000";

  // The shared service token must never be sent to an operator typo, DNS
  // alias, redirect, or user-controlled endpoint. ECS uses task loopback;
  // the disposable and durable Podman stacks use the fixed Compose service.
  if (supplied !== expected) throw new BackendUnavailableError();
  return expected;
}

function configuredServiceToken() {
  const token = process.env.BACKEND_SERVICE_TOKEN;
  if (!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new BackendUnavailableError();
  return token;
}

/** Make a bounded, authenticated call to the private API. */
export async function requestBackend(
  path: BackendPath,
  options: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {}
) {
  const origin = configuredBackendOrigin();
  const token = configuredServiceToken();
  const method = options.method ?? "GET";
  const headers = new Headers({ "X-Backend-Service-Token": token });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");

  try {
    const response = await fetch(new URL(path, origin), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      redirect: "error",
      // Neon may need a few seconds to wake its compute after inactivity.
      signal: AbortSignal.timeout(process.env.VERCEL === "1" ? 25_000 : 8_000)
    });
    // An internal service-token mismatch is a deployment failure, never an
    // end-user authentication result to pass through to the browser.
    if (response.status === 401 || response.status === 403) throw new BackendUnavailableError();
    return response;
  } catch {
    throw new BackendUnavailableError();
  }
}

async function readSuccessfulJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new BackendUnavailableError();
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }
  } catch {
    // The internal service returned an invalid contract.
  }
  throw new BackendUnavailableError();
}

export async function getBackendStatus(): Promise<BackendStatus> {
  const payload = await readSuccessfulJson(await requestBackend("/v1/status"));
  const mode = payload.mode;
  if ((mode !== "database" && mode !== "hosted" && mode !== "disabled")
    || typeof payload.coordinatorAvailable !== "boolean"
    || payload.coordinatorAvailable !== (mode === "database")) {
    throw new BackendUnavailableError();
  }
  return { mode, coordinatorAvailable: payload.coordinatorAvailable };
}

export async function backendCoordinatorAvailability(): Promise<"available" | "disabled" | "unavailable"> {
  try {
    return (await getBackendStatus()).coordinatorAvailable ? "available" : "disabled";
  } catch {
    return "unavailable";
  }
}

/** A 404 is the only lookup result that means the bearer link is inactive. */
export async function resolveBackendInvitation(token: string): Promise<ResolvedInvitation | null> {
  const response = await requestBackend("/v1/invitations/resolve", {
    method: "POST",
    body: { token }
  });
  if (response.status === 404) return null;
  const payload = await readSuccessfulJson(response);
  const resolved = payload.resolved;
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) throw new BackendUnavailableError();
  const invitation = (resolved as Record<string, unknown>).invitation;
  const events = (resolved as Record<string, unknown>).events;
  const wedding = (resolved as Record<string, unknown>).wedding;
  if (!invitation || typeof invitation !== "object" || Array.isArray(invitation)
    || !Array.isArray(events)
    || !wedding || typeof wedding !== "object" || Array.isArray(wedding)
    || (invitation as Record<string, unknown>).token !== token) {
    throw new BackendUnavailableError();
  }
  return resolved as ResolvedInvitation;
}

export async function getBackendCoordinatorWorkspace(): Promise<CoordinatorWorkspace> {
  const payload = await readSuccessfulJson(await requestBackend("/v1/coordinator/workspace"));
  if (!payload.issuerOptions || typeof payload.issuerOptions !== "object" || Array.isArray(payload.issuerOptions)
    || !Array.isArray(payload.invitations)) {
    throw new BackendUnavailableError();
  }
  return {
    issuerOptions: payload.issuerOptions as DatabaseInvitationIssuerOptions,
    invitations: payload.invitations as DatabaseCoordinatorInvitation[]
  };
}

export async function listBackendCoordinatorInvitations(): Promise<DatabaseCoordinatorInvitation[]> {
  const payload = await readSuccessfulJson(await requestBackend("/v1/coordinator/invitations"));
  if (!Array.isArray(payload.invitations)) throw new BackendUnavailableError();
  return payload.invitations as DatabaseCoordinatorInvitation[];
}

export async function getBackendCoordinatorContent(): Promise<DatabaseWeddingContentSnapshot> {
  const payload = await readSuccessfulJson(await requestBackend("/v1/coordinator/content"));
  const snapshot = payload.configuration;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new BackendUnavailableError();
  const content = snapshot as Record<string, unknown>;
  if (!content.settings || typeof content.settings !== "object"
    || !Array.isArray(content.events) || !Array.isArray(content.contacts)) {
    throw new BackendUnavailableError();
  }
  return snapshot as DatabaseWeddingContentSnapshot;
}

/** Preserve backend error status/body for the browser-facing BFF routes. */
export async function forwardBackendJson(response: Response) {
  const retryAfter = response.headers.get("retry-after");
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new BackendUnavailableError();
  }
  return {
    payload,
    status: response.status,
    headers: retryAfter ? { "Retry-After": retryAfter } : undefined
  };
}
