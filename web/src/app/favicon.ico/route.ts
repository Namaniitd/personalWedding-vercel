// Legacy browser requests still reach the same code-native SVG app icon.
export function GET() {
  return new Response(null, {
    status: 308,
    headers: {
      Location: "/icon.svg",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
