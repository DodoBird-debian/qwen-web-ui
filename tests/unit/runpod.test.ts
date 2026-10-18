import { describe, expect, it, vi } from "vitest";
import { RunpodClient, workerOutput } from "../../src/api/runpod";
describe("RunPod transport", () => {
  it("uses server auth only for the configured endpoint and sends no placeholder key", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response('{"workers":{}}'),
    );
    await new RunpodClient("default-endpoint", "", fetcher, "default-endpoint").health();
    expect(fetcher.mock.calls[0][0]).toBe("/api/runpod/default-endpoint/health");
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty("X-RunPod-Api-Key");
    expect(() => new RunpodClient("other-endpoint", "", fetcher, "default-endpoint")).toThrow("API key");
    expect(() => new RunpodClient("default-endpoint", "\r\n", fetcher, "default-endpoint")).toThrow("API key");
    expect(() => new RunpodClient("default-endpoint", "")).toThrow("API key");
  });
  it("uses same origin, the dedicated auth header, unchanged body and lossless response parsing", async () => {
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          '{"id":"job-1","status":"COMPLETED","output":{"images":[{"seed":9223372036854775807}]}}',
        ),
    );
    const client = new RunpodClient(
      "endpoint",
      "test-key",
      fetcher as typeof fetch,
    );
    const response = await client.submit('{"input":{"prompt":"x"}}');
    expect(fetcher.mock.calls[0][0]).toBe("/api/runpod/endpoint/run");
    const options = fetcher.mock.calls[0][1] as RequestInit;
    expect(options.body).toBe('{"input":{"prompt":"x"}}');
    expect(options.headers).toMatchObject({ "X-RunPod-Api-Key": "test-key" });
    expect(String(response.output.images[0].seed)).toBe("9223372036854775807");
  });
  it("treats completed worker error dictionaries as errors", () => {
    expect(() =>
      workerOutput({
        id: "j",
        status: "COMPLETED",
        output: { error: "positional limit" },
      }),
    ).toThrow("positional limit");
    expect(() =>
      workerOutput({ id: "j", status: "FAILED", error: "worker failed" }),
    ).toThrow("worker failed");
  });
  it("does not retry a lost submission response", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      new RunpodClient("e", "test", fetcher).submit("{}"),
    ).rejects.toThrow("fetch");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("restricts IDs and reports auth failure without echoing a response body", async () => {
    expect(() => new RunpodClient("https://evil.test", "key")).toThrow(
      "endpoint",
    );
    const client = new RunpodClient(
      "e",
      "test",
      vi.fn(async () => new Response("sensitive server echo", { status: 401 })),
    );
    await expect(client.health()).rejects.toThrow("RunPod HTTP 401");
  });
});

it("retries transient status reads but never auth failures or submissions", async () => {
  const { poll } = await import("../../src/api/runpod");
  vi.useFakeTimers();
  try {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response('{"id":"j","status":"COMPLETED"}'));
    const pending = poll(
      new RunpodClient("e", "key", fetcher),
      "j",
      () => {},
      new AbortController().signal,
    );
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe("COMPLETED");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const denied = vi.fn(async () => new Response("", { status: 401 }));
    await expect(
      poll(
        new RunpodClient("e", "key", denied),
        "j",
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow("401");
    expect(denied).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
