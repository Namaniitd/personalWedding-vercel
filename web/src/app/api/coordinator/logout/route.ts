import { NextRequest } from "next/server";

import { privateEmpty, privateJson } from "@/lib/server/private-response";
import {
  COORDINATOR_SESSION_COOKIE,
  configuredCanonicalPublicOrigin,
  coordinatorSessionCookieOptions,
  isAuthorizedCoordinatorRequest,
  isSameOriginRequest,
  revokeCoordinatorSession
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALB_SESSION_COOKIE = "shaadi_coordinator_mfa";
const ALB_SESSION_SHARDS = 4;
const MAX_LOGOUT_URL_LENGTH = 2_048;
const COGNITO_HOSTNAME = /^[a-z0-9-]+\.auth\.[a-z0-9-]+\.amazoncognito\.com$/;
const COGNITO_CLIENT_ID = /^[a-z0-9]{26}$/;

/** Accept only the Cognito logout destination created for this public site. */
function configuredCognitoLogoutUrl() {
  const configured = process.env.COORDINATOR_COGNITO_LOGOUT_URL;
  const publicOrigin = configuredCanonicalPublicOrigin();
  if (
    !configured
    || configured.length > MAX_LOGOUT_URL_LENGTH
    || configured.trim() !== configured
    || !publicOrigin?.startsWith("https://")
  ) return null;

  try {
    const url = new URL(configured);
    const query = [...url.searchParams.entries()];
    if (
      url.protocol !== "https:"
      || !COGNITO_HOSTNAME.test(url.hostname)
      || url.port
      || url.username
      || url.password
      || url.pathname !== "/logout"
      || url.hash
      || query.length !== 2
      || url.searchParams.getAll("client_id").length !== 1
      || url.searchParams.getAll("logout_uri").length !== 1
      || !COGNITO_CLIENT_ID.test(url.searchParams.get("client_id") ?? "")
      || url.searchParams.get("logout_uri") !== `${publicOrigin}/`
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!request.headers.get("origin") || !isSameOriginRequest(request) || !await isAuthorizedCoordinatorRequest(request)) {
    return privateJson({ error: "This request was blocked." }, 403);
  }
  if (!await revokeCoordinatorSession(request.headers)) {
    return privateJson({ error: "Coordinator sign-out could not be completed. Please try again." }, 503);
  }

  // A malformed hosted destination never becomes a browser redirect. Clear
  // the local session anyway so a configuration mistake cannot trap sign-out.
  const logoutUrl = configuredCognitoLogoutUrl();
  const response = logoutUrl ? privateJson({ logoutUrl }) : privateEmpty(204);
  response.cookies.set({
    name: COORDINATOR_SESSION_COOKIE,
    value: "",
    ...coordinatorSessionCookieOptions(request, 0)
  });
  if (process.env.COORDINATOR_COGNITO_LOGOUT_URL !== undefined) {
    for (const name of [ALB_SESSION_COOKIE, ...Array.from({ length: ALB_SESSION_SHARDS }, (_, index) => `${ALB_SESSION_COOKIE}-${index}`)]) {
      response.cookies.set({ name, value: "", httpOnly: true, secure: true, path: "/", maxAge: 0 });
    }
  }
  return response;
}

async function methodNotAllowed(request: NextRequest) {
  void request;
  return privateEmpty(405, { Allow: "POST" });
}

export async function GET(request: NextRequest) {
  return methodNotAllowed(request);
}

export async function HEAD(request: NextRequest) {
  return methodNotAllowed(request);
}

export async function PUT(request: NextRequest) {
  return methodNotAllowed(request);
}

export async function PATCH(request: NextRequest) {
  return methodNotAllowed(request);
}

export async function DELETE(request: NextRequest) {
  return methodNotAllowed(request);
}

export async function OPTIONS(request: NextRequest) {
  void request;
  return privateEmpty(204, { Allow: "POST" });
}
