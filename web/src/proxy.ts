import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getBackendStatus } from "@/lib/server/backend-client";
import { isLocalStackPublicOrigin } from "@/lib/server/local-stack";
import { takeRateLimit } from "@/lib/server/rate-limit";
import {
  clientNetworkIdentifier,
  isAuthorizedCoordinatorRequest
} from "@/lib/server/request-security";

function contentSecurityPolicy(nonce: string) {
  const isDevelopment = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'${isDevelopment ? " 'unsafe-inline'" : ""}`,
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    ...(isDevelopment || isLocalStackPublicOrigin() ? [] : ["upgrade-insecure-requests"])
  ].join("; ");
}

function isCoordinatorPath(pathname: string) {
  return pathname === "/coordinator"
    || pathname.startsWith("/coordinator/")
    || pathname === "/api/coordinator"
    || pathname.startsWith("/api/coordinator/");
}

function isCoordinatorLoginPath(pathname: string) {
  return pathname === "/coordinator/login" || pathname === "/api/coordinator/login";
}

function isCoordinatorApiPath(pathname: string) {
  return pathname === "/api/coordinator" || pathname.startsWith("/api/coordinator/");
}

function coordinatorAccessResponse(
  status: 401 | 404,
  csp: string
) {
  const isUnauthorized = status === 401;
  return new NextResponse(
    isUnauthorized ? "Coordinator authentication is required." : "Coordinator access is unavailable.",
    {
      status,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Security-Policy": csp,
        "Content-Type": "text/plain; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-Robots-Tag": "noindex, nofollow, noarchive"
      }
    }
  );
}

function coordinatorLoginRedirect(request: NextRequest, csp: string) {
  const response = NextResponse.redirect(new URL("/coordinator/login", request.url));
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

/**
 * A nonce-based CSP protects the personalized HTML without allowing arbitrary
 * inline script/style. Next.js reads the request CSP and applies this nonce to
 * its framework tags while rendering.
 */
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  const pathname = request.nextUrl.pathname;
  // Media handlers perform their own invitation lookup and separate rate limit.
  const isInvitationPage = pathname.startsWith("/i/") && !/^\/i\/[^/]+\/media(?:\/|$)/.test(pathname);
  const needsBackendStatus = isCoordinatorPath(pathname) || isInvitationPage;
  const backendStatus = needsBackendStatus ? await getBackendStatus().catch(() => null) : null;

  // The sign-in page remains reachable when database configuration is missing
  // so it can explain how to restore coordinator access. Every other workspace
  // page redirects there, and route handlers repeat the authorization checks.
  if (isCoordinatorPath(pathname)) {
    if (backendStatus && !backendStatus.coordinatorAvailable && !isCoordinatorLoginPath(pathname)) {
      return isCoordinatorApiPath(pathname)
        ? coordinatorAccessResponse(404, csp)
        : coordinatorLoginRedirect(request, csp);
    }
    if (!isCoordinatorLoginPath(pathname) && !await isAuthorizedCoordinatorRequest(request)) {
      return isCoordinatorApiPath(pathname)
        ? coordinatorAccessResponse(401, csp)
        : coordinatorLoginRedirect(request, csp);
    }
  }

  if (isInvitationPage && (!backendStatus || backendStatus.mode === "disabled")) {
    return new NextResponse("The invitation service is temporarily unavailable.", {
      status: 503,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Security-Policy": csp,
        "Content-Type": "text/plain; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "X-Robots-Tag": "noindex, nofollow, noarchive"
      }
    });
  }

  if (isInvitationPage) {
    const limit = await takeRateLimit(`invitation-page:network:${clientNetworkIdentifier(request)}`, 120);
    if (!limit.allowed) {
      return new NextResponse("Please wait a minute before trying again.", {
        status: 429,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "Content-Security-Policy": csp,
          "Content-Type": "text/plain; charset=utf-8",
          "Referrer-Policy": "no-referrer",
          "Retry-After": String(limit.retryAfterSeconds),
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "X-Robots-Tag": "noindex, nofollow, noarchive"
        }
      });
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Private bearer-link routes must never opt out of CSP, availability, or
    // rate-limit handling based on a client-controlled prefetch header.
    "/i/:path*",
    // These explicit matchers cannot be bypassed with the prefetch headers
    // deliberately excluded from the general page matcher below.
    "/coordinator/:path*",
    "/api/coordinator/:path*",
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" }
      ]
    }
  ]
};
