// Local fixture only: verify server defaults without contacting RunPod.
import assert from "node:assert/strict";
import { createServer as httpServer } from "node:http";
import { createServer } from "vite";

Object.assign(process.env, {
  RUNPOD_ENDPOINT_ID: "base-fixture", RUNPOD_ENDPOINT_URL: "https://api.runpod.ai/v2/base-fixture",
  RUNPOD_API_KEY: "base-fixture-key",
  RUNPOD_TURBO_ENDPOINT_ID: "turbo-fixture", RUNPOD_TURBO_ENDPOINT_URL: "https://api.runpod.ai/v2/turbo-fixture/runsync",
  RUNPOD_TURBO_API_KEY: "turbo-fixture-key",
});
const upstream = httpServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ path: request.url, authorization: request.headers.authorization ?? null }));
});
await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
let vite;
try {
  vite = await createServer({ server: { host: "127.0.0.1", port: 5191, strictPort: true,
    proxy: { "/api/runpod": { target: `http://127.0.0.1:${upstream.address().port}` } } }, logLevel: "error" });
  await vite.listen();
  const get = async (path, headers = {}) => (await fetch(`http://127.0.0.1:5191${path}`, { headers })).json();
  assert.deepEqual(await get("/api/runpod/base-fixture/health"), { path: "/v2/base-fixture/health", authorization: "Bearer base-fixture-key" });
  assert.deepEqual(await get("/api/runpod/turbo-fixture/health"), { path: "/v2/turbo-fixture/health", authorization: "Bearer turbo-fixture-key" });
  assert.equal((await get("/api/runpod/turbo-fixture/health", { "X-RunPod-Api-Key": "override-fixture-key" })).authorization, "Bearer override-fixture-key");
  assert.equal((await get("/api/runpod/unknown-fixture/health")).authorization, null);
  const config = await get("/config.json");
  assert.equal(config.models.base.endpointId, "base-fixture");
  assert.equal(config.models.turbo.endpointId, "turbo-fixture");
  assert.equal(config.models.turbo.serverAuth, true);
  assert.equal(JSON.stringify(config).includes("fixture-key"), false);
  console.log("PASS: development proxy isolates both server keys, honors overrides, and serves no secrets.");
} finally {
  await vite?.close();
  await new Promise(resolve => upstream.close(resolve));
}
