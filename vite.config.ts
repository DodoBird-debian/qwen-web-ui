import { defineConfig, loadEnv } from "vite";
import { readFileSync } from "node:fs";

// Development convenience only. Production uses nginx/runpod.conf.
export default defineConfig(({ mode }) => {
  // Browser tests use mocked endpoints and must not inherit private defaults.
  const env = mode === "test" ? {} : { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const defaults = new Map<string, string>();
  const models: Record<string, { endpointId: string; serverAuth: boolean }> = {};
  for (const [model, prefix] of [["base", "RUNPOD"], ["turbo", "RUNPOD_TURBO"]]) {
    const url = /^https:\/\/api\.runpod\.ai\/v2\/([A-Za-z0-9_-]+)(?:\/(?:run|runsync|health))?\/?$/.exec(env[`${prefix}_ENDPOINT_URL`] || "");
    const id = env[`${prefix}_ENDPOINT_ID`] || url?.[1] || "";
    const key = env[`${prefix}_API_KEY`] || "";
    if (/^[A-Za-z0-9_-]+$/.test(id) && key && !/[\r\n]/.test(key)) {
      if (url && url[1] !== id) throw new Error(`${prefix} endpoint ID and URL disagree.`);
      if (defaults.has(id)) throw new Error("Base and Turbo defaults must use separate endpoint IDs.");
      defaults.set(id, key);
      models[model] = { endpointId: id, serverAuth: true };
    }
  }
  return {
  plugins: [{
    name: "private-runpod-defaults",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] !== "/config.json" || !defaults.size) return next();
        const config = JSON.parse(readFileSync(new URL("./public/config.json", import.meta.url), "utf8"));
        config.models = { ...config.models };
        for (const [model, connection] of Object.entries(models))
          config.models[model] = { ...(model === "base" ? config : config.models[model]), ...connection, models: undefined };
        if (models.base) Object.assign(config, models.base);
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        response.end(JSON.stringify(config));
      });
    },
  }],
  server: {
    proxy: {
      "/api/runpod": {
        target: "https://api.runpod.ai",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/runpod/, "/v2"),
        configure(proxy) {
          proxy.on("proxyReq", (request, incoming) => {
            const endpoint = /^\/(?:api\/runpod|v2)\/([A-Za-z0-9_-]+)\//.exec(incoming.url || "")?.[1];
            const override = incoming.headers["x-runpod-api-key"];
            const key = typeof override === "string" && override ? override : defaults.get(endpoint || "");
            request.removeHeader("Authorization");
            if (key)
              request.setHeader("Authorization", `Bearer ${key}`);
            request.removeHeader("x-runpod-api-key");
          });
        },
      },
    },
  },
  };
});
