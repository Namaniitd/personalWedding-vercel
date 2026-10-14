import { NextResponse } from "next/server";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Cross-Origin-Resource-Policy": "same-origin"
};

function headers(extra?: HeadersInit) {
  const result = new Headers(privateHeaders);
  if (extra) {
    new Headers(extra).forEach((value, key) => result.set(key, value));
  }
  return result;
}

export function privateJson(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  return NextResponse.json(body, { status, headers: headers(extraHeaders) });
}

export function privateText(body: string, status = 200, extraHeaders?: HeadersInit) {
  return new NextResponse(body, { status, headers: headers(extraHeaders) });
}

export function privateEmpty(status: number, extraHeaders?: HeadersInit) {
  return new NextResponse(null, { status, headers: headers(extraHeaders) });
}

export function privateBinary(body: ArrayBuffer, contentType: string) {
  return new NextResponse(body, { headers: headers({ "Content-Type": contentType }) });
}
