import { defineConfig, loadEnv } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget =
    env.SPEC_UI_PROXY_TARGET ||
    `http://${env.SPEC_UI_HOST || "127.0.0.1"}:${env.SPEC_UI_PORT || "8790"}`;

  const apiProxy = {
    "/api": {
      target: apiTarget,
      changeOrigin: true,
    },
  } as const;

  return {
    plugins: [preact()],
    server: {
      port: 5173,
      proxy: { ...apiProxy },
    },
    preview: {
      port: 4173,
      proxy: { ...apiProxy },
    },
  };
});
