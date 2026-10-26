import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Pin Turbopack's root to this application. Without it, an unrelated
// pnpm-workspace.yaml above the project can expand its filesystem scope and
// produce a misleading build warning.
const applicationRoot = dirname(fileURLToPath(import.meta.url));

const baselineSecurityHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : [])
];

const privateRouteHeaders = [
  ...baselineSecurityHeaders,
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }
];

// The gate-scanner is the only browser feature that needs camera access. Keep
// the permission unavailable to guest invitation and API routes, even though
// they share the same private/no-store response policy.
const coordinatorRouteHeaders = [
  ...baselineSecurityHeaders.filter((header) => header.key !== "Permissions-Policy"),
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(), microphone=(), payment=(), usb=()" },
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }
];

const nextConfig: NextConfig = {
  // Produces the minimal Node server used by the ECS/Fargate Docker image.
  output: "standalone",
  outputFileTracingIncludes: {
    "/i/*/media/*": ["./private-media/**/*.jpg", "./private-media/**/*.webp", "./private-media/music/raabta-instrumental.m4a", "./private-media/teaser/prewedding-teaser-hd.mp4", "./private-media/teaser/prewedding-teaser-4k.mp4"],
    "/rsvp/*/media/*": ["./private-media/**/*.jpg", "./private-media/**/*.webp", "./private-media/music/raabta-instrumental.m4a", "./private-media/teaser/prewedding-teaser-hd.mp4", "./private-media/teaser/prewedding-teaser-4k.mp4"]
  },
  outputFileTracingExcludes: {
    "/i/*/media/*": ["./private-media/teaser/comingSoon*.mp4", "./private-media/teaser/*-source.*", "./private-media/prewedding/vertical/**/*", "./private-media/prewedding/horizontal/**/*", "./private-media/**/.DS_Store"],
    "/rsvp/*/media/*": ["./private-media/teaser/comingSoon*.mp4", "./private-media/teaser/*-source.*", "./private-media/prewedding/vertical/**/*", "./private-media/prewedding/horizontal/**/*", "./private-media/**/.DS_Store"]
  },
  poweredByHeader: false,
  turbopack: {
    root: applicationRoot
  },
  // Next 16 requires an explicit image-quality allowlist. The two higher
  // values preserve detail in the local wedding photography without opening
  // the optimizer to arbitrary quality requests.
  images: {
    // The optimizer must not cache private media under a public /_next/image URL.
    localPatterns: [{ pathname: "/images/invitation-share.png", search: "" }],
    qualities: [75, 80, 82]
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: baselineSecurityHeaders
      },
      {
        source: "/",
        headers: privateRouteHeaders
      },
      {
        source: "/i/:path*",
        headers: privateRouteHeaders
      },
      {
        source: "/rsvp/:path*",
        headers: privateRouteHeaders
      },
      {
        source: "/api/:path*",
        headers: privateRouteHeaders
      },
      {
        // `:path*` includes the coordinator root and every nested workspace
        // route. The more specific login rule below overrides camera access.
        source: "/coordinator/:path*",
        headers: coordinatorRouteHeaders
      },
      {
        source: "/coordinator/login",
        headers: privateRouteHeaders
      },
      { source: "/coordinator/g/login", headers: privateRouteHeaders },
      { source: "/coordinator/b/login", headers: privateRouteHeaders }
    ];
  }
};

export default nextConfig;
