import { defineConfig } from "vite";

// Development convenience only. Production uses nginx/runpod.conf.
export default defineConfig({
  server: {
    proxy: {
      "/api/runpod": {
        target: "https://api.runpod.ai",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/runpod/, "/v2"),
        configure(proxy) {
          proxy.on("proxyReq", (request, incoming) => {
            const key = incoming.headers["x-runpod-api-key"];
            if (typeof key === "string")
              request.setHeader("Authorization", `Bearer ${key}`);
            request.removeHeader("x-runpod-api-key");
          });
        },
      },
    },
  },
});
