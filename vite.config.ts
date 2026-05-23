import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const hostFromUrl = (value?: string) => {
  try {
    return value ? new URL(value).hostname : undefined;
  } catch {
    return undefined;
  }
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const webappHost = hostFromUrl(env.WEBAPP_URL);
  const oidcHost = hostFromUrl(env.TELEGRAM_OIDC_REDIRECT_URI);
  const allowedHosts = Array.from(new Set([webappHost, oidcHost].filter(Boolean) as string[]));

  return {
    plugins: [react()],
    build: {
      cssCodeSplit: true,
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom"],
            ui: ["lucide-react", "qrcode.react"],
          },
        },
      },
    },
    server: {
      allowedHosts,
      proxy: {
        "/api": {
          target: "http://localhost:8787",
          changeOrigin: true,
        },
      },
    },
  };
});
