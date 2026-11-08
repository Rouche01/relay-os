import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [preact()],
  // @xyflow/react imports `react`; run it through Preact compat.
  resolve: {
    alias: [
      { find: "react-dom/test-utils", replacement: "preact/test-utils" },
      { find: "react-dom", replacement: "preact/compat" },
      { find: "react/jsx-runtime", replacement: "preact/jsx-runtime" },
      { find: "react/jsx-dev-runtime", replacement: "preact/jsx-dev-runtime" },
      { find: "react", replacement: "preact/compat" },
    ],
  },
  optimizeDeps: {
    include: ["@xyflow/react", "preact/compat"],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    // Browser dogfood (Vite tab) — gateway/HITL/Spec have no CORS; proxy locally.
    proxy: {
      "/__desk/gateway": {
        target: "http://127.0.0.1:9000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__desk\/gateway/, ""),
      },
      "/__desk/hitl": {
        target: "http://127.0.0.1:9100",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__desk\/hitl/, ""),
      },
      "/__desk/spec": {
        target: "http://127.0.0.1:8790",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__desk\/spec/, ""),
      },
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
