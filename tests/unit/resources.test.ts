import { describe, it, expect, vi } from "vitest";
import { SubmissionGuard } from "../../src/generation/submission-guard";
import { RunpodHttpError, RunpodClient, poll } from "../../src/api/runpod";
import { JobManager, type SavedJob } from "../../src/api/jobs";
import { DEFAULTS } from "../../src/api/contract";
import { EditPreparationCache } from "../../src/resources/edit-preparation";
import type { MaskEditor } from "../../src/editor/mask-editor";
import type { PreparedInpaint } from "../../src/editor/inpaint";
import { fitEncoded } from "../../src/export/encode";
import { requestSignal } from "../../src/lib/request-signal";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) || null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
}
const prepared = {
  input: { ...DEFAULTS, prompt: "fox", images: [] },
  body: "{}",
};
function job(): SavedJob {
  return {
    id: "e:j",
    endpoint: "e",
    runpodId: "j",
    status: "IN_PROGRESS",
    input: prepared.input,
    created: 0,
  };
}
describe("paid compute protection", () => {
  it("retains unresolved identity across reload without user content, and rejects overlapping submissions", () => {
    const store = storage(),
      first = new SubmissionGuard(store);
    first.begin("e");
    expect(() => first.begin("e")).toThrow("previous");
    const reloaded = new SubmissionGuard(store);
    expect(reloaded.pending).toMatchObject({ endpoint: "e" });
    reloaded.accepted("e", "j");
    expect(() => reloaded.accepted("e", "other")).toThrow("unresolved");
    expect(() => reloaded.acknowledgeUnknown()).toThrow("known");
    reloaded.completed("e", "other");
    expect(reloaded.pending?.id).toBe("j");
    reloaded.completed("e", "j");
    expect(new SubmissionGuard(store).pending).toBeUndefined();
  });
  it("distinguishes definitive rejection from ambiguous network/timeout/server failures", () => {
    for (const error of [
      new TypeError("fetch"),
      new RunpodHttpError(503, "gateway"),
      new RunpodHttpError(408, "timeout"),
    ]) {
      const g = new SubmissionGuard();
      g.begin("e");
      g.rejected(error);
      expect(g.pending).toBeDefined();
      g.acknowledgeUnknown();
      expect(g.pending).toBeUndefined();
    }
    const g = new SubmissionGuard();
    g.begin("e");
    g.rejected(new RunpodHttpError(413, "too large"));
    expect(g.pending).toBeUndefined();
  });
  it("publishes accepted ID before storage finishes; pause never allows a second POST", async () => {
    let save!: () => void;
    const update = vi.fn(),
      fetcher = vi.fn(
        async () => new Response('{"id":"j","status":"IN_QUEUE"}'),
      );
    const m = new JobManager({ update, storageError: vi.fn() }, 12, {
      save: () =>
        new Promise<void>((r) => {
          save = r;
        }),
    });
    const client = new RunpodClient("e", "key", fetcher);
    const running = m.submit(client, "e", prepared);
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    expect(m.current?.runpodId).toBe("j");
    await expect(m.submit(client, "e", prepared)).rejects.toThrow("previous");
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockImplementation(
      async () => new Response('{"id":"j","status":"IN_PROGRESS"}'),
    );
    save();
    await vi.waitFor(() => expect(m.polling).toBe(true));
    const paused = expect(running).rejects.toMatchObject({
      name: "AbortError",
    });
    m.pause();
    await paused;
    await expect(m.submit(client, "e", prepared)).rejects.toThrow("previous");
    expect(m.guard.pending?.id).toBe("j");
  });
  it("does not refetch or decode completed stored results", async () => {
    const client = new RunpodClient("e", "key", vi.fn()),
      m = new JobManager({ update: vi.fn(), storageError: vi.fn() });
    const saved = job();
    saved.status = "COMPLETED";
    saved.results = [
      {
        seed: "1",
        blob: new Blob(),
        width: 512,
        height: 512,
        mime: "image/png",
      },
    ];
    await m.follow(client, saved);
    expect(m.current).toBe(saved);
    expect(m.polling).toBe(false);
  });
  it("stops invalid/mismatched status polling instead of looping forever", async () => {
    for (const body of [
      '{"id":"j","status":"UNKNOWN"}',
      '{"id":"other","status":"COMPLETED"}',
    ]) {
      const fetcher = vi.fn(async () => new Response(body));
      await expect(
        poll(
          new RunpodClient("e", "key", fetcher),
          "j",
          vi.fn(),
          new AbortController().signal,
        ),
      ).rejects.toThrow("invalid job status");
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});

describe("bounded browser work", () => {
  it("serializes preparation, skips superseded revisions, reuses metadata edits, and releases replaced resources", async () => {
    let finish!: (v: PreparedInpaint) => void;
    const result = {
      references: [],
      snapshot: {},
    } as unknown as PreparedInpaint;
    const prepare = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<PreparedInpaint>((r) => {
            finish = r;
          }),
      )
      .mockResolvedValue(result);
    const release = vi.fn(),
      cache = new EditPreparationCache(prepare, release);
    const editor = { sourceId: "a", pixelRevision: 1 } as MaskEditor;
    const options = {
      width: 512,
      height: 512,
      crop: false,
      padding: 0,
      feather: 0,
    };
    const a = cache.get(editor, options);
    await Promise.resolve();
    editor.pixelRevision = 2;
    const b = cache.get(editor, options);
    const skipped = expect(b).rejects.toMatchObject({ name: "AbortError" });
    editor.pixelRevision = 3;
    const c = cache.get(editor, options);
    expect(cache.get(editor, options)).toBe(c);
    expect(prepare).toHaveBeenCalledTimes(1);
    finish(result);
    await a;
    await skipped;
    await c;
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(1);
    cache.clear();
    await Promise.resolve();
    expect(release).toHaveBeenCalledTimes(2);
  });
  it("aborts obsolete quality ladders after the current native encode", async () => {
    const abort = new AbortController();
    const encode = vi.fn(async () => {
      abort.abort();
      return new Blob(["abc"]);
    });
    await expect(fitEncoded(encode, 95, 1, abort.signal)).rejects.toMatchObject(
      { name: "AbortError" },
    );
    expect(encode).toHaveBeenCalledTimes(1);
  });
  it("stops the descending quality ladder at its first fitting candidate", async () => {
    const encode = vi.fn(async (q: number) => new Blob(["x".repeat(q)]));
    expect((await fitEncoded(encode, 95, 80)).quality).toBe(75);
    expect(encode).toHaveBeenCalledTimes(3);
  });
  it("cleans up mobile-compatible timeout and parent-abort listeners", () => {
    vi.useFakeTimers();
    try {
      const parent = new AbortController(),
        a = requestSignal(parent.signal, 100);
      parent.abort();
      expect(a.signal.aborted).toBe(true);
      a.dispose();
      const b = requestSignal(undefined, 100);
      b.dispose();
      vi.runAllTimers();
      expect(b.signal.aborted).toBe(false);
      const c = requestSignal(undefined, 100);
      vi.runAllTimers();
      expect(c.signal.reason.name).toBe("TimeoutError");
      c.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

it("releases an expired job after definitive 404 without treating a network failure as completion", async () => {
  const m = new JobManager({ update: vi.fn(), storageError: vi.fn() });
  const saved = job();
  await expect(
    m.follow(
      new RunpodClient(
        "e",
        "key",
        vi.fn(async () => new Response("", { status: 404 })),
      ),
      saved,
    ),
  ).rejects.toThrow("404");
  expect(saved.status).toBe("EXPIRED");
  expect(m.guard.pending).toBeUndefined();
});
