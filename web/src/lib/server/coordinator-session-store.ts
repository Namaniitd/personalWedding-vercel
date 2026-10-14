import type { CoordinatorSessionRequest } from "@/lib/coordinator-session";
import { requestBackend } from "@/lib/server/backend-client";

/** Never cache an authorization result: logout must affect the next request. */
export async function manageCoordinatorSession(input: CoordinatorSessionRequest): Promise<boolean> {
  try {
    const response = await requestBackend("/v1/security/coordinator-session", { method: "POST", body: input });
    if (!response.ok) return false;
    const result: unknown = await response.json();
    return Boolean(result && typeof result === "object" && !Array.isArray(result)
      && "ok" in result && result.ok === true);
  } catch {
    // A missing migration, API outage, or failed revocation cannot grant access.
    return false;
  }
}
