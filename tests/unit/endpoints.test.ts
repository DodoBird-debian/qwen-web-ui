import { describe, it, expect, vi } from "vitest";
import { EndpointConnections, endpointId } from "../../src/api/endpoints";

describe("independent model connections", () => {
  it("keeps GPU settings editable before an endpoint is connected", () => {
    const connections = new EndpointConnections();
    connections.configure({ endpointId: "", workerOffload: "model" });
    expect(connections.offload("")).toBeUndefined();
  });
  it("accepts RunPod endpoint URLs without changing queue transport", () => {
    expect(endpointId("https://api.runpod.ai/v2/turbo-node/runsync")).toBe("turbo-node");
    expect(endpointId("base-node")).toBe("base-node");
    for (const value of ["https://evil.test/v2/node", "https://api.runpod.ai/v2/node?key=secret", "../node"])
      expect(() => endpointId(value)).toThrow("endpoint");
  });
  it("isolates custom keys and keeps the original job credentials after switching or editing", async () => {
    const fetcher = vi.fn(async () => new Response('{"id":"job","status":"CANCELLED"}'));
    vi.stubGlobal("fetch", fetcher);
    try {
      const connections = new EndpointConnections();
      connections.connect("base", "base-node", "base-secret");
      connections.connect("turbo", "turbo-node", "turbo-secret");
      await connections.client("base-node").cancel("job");
      expect(fetcher.mock.calls[0]).toEqual(expect.arrayContaining(["/api/runpod/base-node/cancel/job"]));
      expect((fetcher.mock.calls[0] as any)[1].headers["X-RunPod-Api-Key"]).toBe("base-secret");
      connections.connect("base", "another-base", "another-secret");
      await connections.client("base-node").health();
      expect((fetcher.mock.calls[1] as any)[1].headers["X-RunPod-Api-Key"]).toBe("base-secret");
      expect(() => connections.client("unconfigured-node")).toThrow("API key");
      expect(() => connections.connect("turbo", "new-turbo", "")).toThrow("API key");
      expect(connections.current.endpoint).toBe("another-base");
    } finally { vi.unstubAllGlobals(); }
  });
  it("allows blank keys only for configured server defaults and never persists secrets", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
    try {
      const config = { endpointId: "base-node", serverAuth: true, models: { turbo: { endpointId: "turbo-node", serverAuth: true } } };
      const connections = new EndpointConnections();
      connections.configure(config);
      connections.connect("base", "base-node", "base-secret");
      connections.connect("turbo", "turbo-node", "turbo-secret");
      connections.persist();
      expect(JSON.stringify([...data])).not.toContain("secret");
      const restored = new EndpointConnections();
      restored.configure(config);
      restored.restore();
      expect(restored.model).toBe("turbo");
      expect(restored.connected).toBe(true);
      expect(restored.current.key).toBe("");
      expect(() => restored.connect("base", "unknown", "")).toThrow("API key");
    } finally { vi.unstubAllGlobals(); }
  });
});
