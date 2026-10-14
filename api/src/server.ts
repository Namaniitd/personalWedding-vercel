import { createServer } from "node:http";
import { Readable } from "node:stream";

import { handleApiRequest } from "./app.js";

function listenPort() {
  const candidate = Number(process.env.PORT ?? "4000");
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535.");
  }
  return candidate;
}

function webRequest(request: import("node:http").IncomingMessage) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }

  const method = request.method ?? "GET";
  return new Request(new URL(request.url ?? "/", "http://api.internal").toString(), {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(request) as ReadableStream<Uint8Array>,
    duplex: "half"
  } as RequestInit & { duplex: "half" });
}

const server = createServer(async (request, response) => {
  try {
    const result = await handleApiRequest(webRequest(request));
    const body = Buffer.from(await result.arrayBuffer());
    if (response.writableEnded || response.destroyed) return;
    response.writeHead(result.status, Object.fromEntries(result.headers.entries()));
    response.end(body);
  } catch {
    if (response.headersSent || response.destroyed) {
      response.destroy();
      return;
    }
    response.writeHead(503, {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    });
    response.end('{"error":"Service unavailable."}');
  }
});

server.requestTimeout = 10_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;

const port = listenPort();
const host = process.env.HOST ?? "0.0.0.0";
server.listen(port, host, () => {
  // Log only the bind address. Invitation and pass tokens never enter URLs or logs.
  process.stdout.write(`shaadi-api listening on ${host}:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
