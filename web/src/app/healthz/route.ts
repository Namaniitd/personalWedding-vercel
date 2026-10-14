export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Load-balancer liveness endpoint. It intentionally does not query Supabase or
// disclose any invitation, configuration, or dependency state.
export function GET() {
  return new Response("ok\n", {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export function HEAD() {
  return new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
