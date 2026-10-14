import { requestBackend } from "@/lib/server/backend-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function ready() {
  try {
    return (await requestBackend("/v1/readyz")).ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const available = await ready();
  return new Response(available ? "ready\n" : "unavailable\n", {
    status: available ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function HEAD() {
  const available = await ready();
  return new Response(null, {
    status: available ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
