import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

const backendTarget = process.env.ALEXANDRIA_BACKEND_URL ?? "http://localhost:4000";

const proxyPaths = ["/api", "/health"] as const;

const proxy: Record<string, string | ProxyOptions> = proxyPaths.reduce(
  (accumulator, path) => {
    accumulator[path] = {
      target: backendTarget,
      changeOrigin: true,
      secure: false
    } satisfies ProxyOptions;
    return accumulator;
  },
  {} as Record<string, string | ProxyOptions>
);

const preferredPort = Number.parseInt(
  process.env.VITE_DEV_SERVER_PORT ?? process.env.PORT ?? "4173",
  10
);

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number.isFinite(preferredPort) ? preferredPort : 4173,
    host: "0.0.0.0",
    strictPort: true,
    proxy,
    fs: {
      allow: [".."],
    }
  }
});
