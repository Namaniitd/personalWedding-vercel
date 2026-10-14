import { defineConfig } from "tsup";

export default defineConfig({
  entry: { server: "src/server.ts", vercel: "api/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true
});
