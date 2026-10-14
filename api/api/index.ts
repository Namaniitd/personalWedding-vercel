import { handleApiRequest } from "../src/app.js";

const ROUTE_PARAMETER = "__shaadi_route";

/** Restore the application path when Vercel supplies the rewrite destination. */
function routedRequest(request: Request) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/index") return request;

  const routes = url.searchParams.getAll(ROUTE_PARAMETER);
  const path = routes.length === 1 ? routes[0] : undefined;
  if (path === "/healthz" || path === "/readyz" || path?.startsWith("/v1/")) {
    url.pathname = path;
    url.searchParams.delete(ROUTE_PARAMETER);
    return new Request(url, request);
  }
  return request;
}

/** One Node function, with no listening server and no request logging. */
export default {
  async fetch(request: Request): Promise<Response> {
    try {
      return await handleApiRequest(routedRequest(request));
    } catch {
      return Response.json({ error: "Service unavailable." }, {
        status: 503,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "X-Robots-Tag": "noindex, nofollow, noarchive"
        }
      });
    }
  }
};
