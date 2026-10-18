import { describe, it, expect, vi } from "vitest";
import { planSeries, planGrid } from "../../src/generation/plan";
import { SeriesRunner } from "../../src/generation/runner";
import { DEFAULTS, MAX_SEED } from "../../src/api/contract";
import type { SavedJob } from "../../src/api/jobs";
const input = { ...DEFAULTS, prompt: "A ceramic fox", seed: "100", images: [] };
function completed(
  request: ReturnType<typeof planSeries>["requests"][number],
  id = "j",
): SavedJob {
  return {
    id,
    runpodId: id,
    endpoint: "e",
    created: 0,
    status: "COMPLETED",
    input: request.prepared.input,
    results: request.cells.map((c) => ({
      id: c.id,
      blob: new Blob(),
      seed: c.input.seed,
      width: 512,
      height: 512,
      mime: "image/png",
    })),
  };
}
describe("frozen API run planning", () => {
  it("splits 20 images into five batches with 20 consecutive exact seeds", () => {
    const p = planSeries(input, 20, 4);
    expect(
      p.requests.map((r) => [
        r.prepared.input.seed,
        r.prepared.input.num_images,
      ]),
    ).toEqual([
      ["100", 4],
      ["104", 4],
      ["108", 4],
      ["112", 4],
      ["116", 4],
    ]);
    expect(p.cells.map((c) => c.input.seed)).toEqual(
      Array.from({ length: 20 }, (_, i) => String(100 + i)),
    );
    expect(p.requests.every((r) => r.prepared.bytes <= 10_000_000)).toBe(true);
    expect(Object.keys(p.requests[0].prepared.input)).not.toContain(
      "total_images",
    );
  });
  it("uses remainders, wraps seeds, and randomizes only the base seed", () => {
    const random = vi.fn(() => MAX_SEED.toString());
    const p = planSeries({ ...input, seed: "-1" }, 6, 4, random);
    expect(random).toHaveBeenCalledTimes(1);
    expect(p.cells.map((c) => c.input.seed)).toEqual([
      MAX_SEED.toString(),
      "0",
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(p.requests.map((r) => r.prepared.input.num_images)).toEqual([4, 2]);
    expect(planSeries(input, 20, 1).requests).toHaveLength(20);
  });
  it("keeps fixed seeds for CFG/step grids, removes negative prompt at CFG 1", () => {
    const p = planGrid(
      input,
      "steps",
      "20,40,60",
      "cfg",
      "1,2,3",
      "avoid blur",
      4,
    );
    expect(p.requests).toHaveLength(9);
    expect(new Set(p.cells.map((c) => c.input.seed))).toEqual(new Set(["100"]));
    expect(p.cells[0].input.negative_prompt).toBeUndefined();
    expect(p.cells[3].input.negative_prompt).toBe("avoid blur");
    expect(p.cells[8]).toMatchObject({ row: 2, column: 2 });
  });
  it("only groups cells that have identical settings and consecutive seeds", () => {
    const p = planGrid(
      input,
      "seed",
      "100,101,102,103,104",
      "steps",
      "20,40",
      "",
      4,
    );
    expect(p.requests.map((r) => r.cells.length)).toEqual([4, 1, 4, 1]);
    for (const r of p.requests)
      expect(
        new Set(r.cells.map((c) => c.input.num_inference_steps)).size,
      ).toBe(1);
  });
  it("rejects excess cells, invalid axis values and oversized requests", () => {
    expect(() => planGrid(input, "cfg", "0", "none", "")).toThrow("CFG");
    expect(() => planGrid(input, "steps", "1.5", "none", "")).toThrow("steps");
    expect(() =>
      planGrid(
        input,
        "steps",
        Array.from({ length: 9 }, (_, i) => String(i + 1)).join(","),
        "cfg",
        "1,1.1,1.2,1.3,1.4,1.5,1.6,1.7",
      ),
    ).toThrow("64");
    expect(() =>
      planSeries({ ...input, images: ["A".repeat(10_000_000)] }, 2, 1),
    ).toThrow("maximum");
  });
});
describe("finite browser runner", () => {
  it("collects all 20 images in order without depending on history retention", async () => {
    const p = planSeries(input, 20, 4),
      calls: string[] = [];
    const runner = new SeriesRunner(
      p,
      async (r) => {
        calls.push(r.id);
        return completed(r, r.id);
      },
      () => {},
    );
    await runner.start();
    expect(calls).toHaveLength(5);
    expect(runner.state).toBe("completed");
    expect(runner.completed).toBe(20);
    expect(runner.jobs).toHaveLength(5);
  });
  it("stops after the current accepted batch and never submits the next", async () => {
    const p = planSeries(input, 20, 4);
    let runner: SeriesRunner;
    const execute = vi.fn(async (r: any) => {
      runner.stop();
      return completed(r);
    });
    runner = new SeriesRunner(p, execute, () => {});
    await runner.start();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(runner.completed).toBe(4);
    expect(runner.state).toBe("stopped");
  });
  it("never retries an uncertain submission", async () => {
    const execute = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
      runner = new SeriesRunner(planSeries(input, 20, 4), execute, () => {});
    await runner.start();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(runner.state).toBe("submission-uncertain");
    expect(runner.cells.get("image-0")?.status).toBe("unknown");
    expect(runner.error).toContain("Check the endpoint");
  });
  it("retains raw partial results on worker failure and leaves later cells pending", async () => {
    let runner: SeriesRunner;
    const p = planSeries(input, 8, 4);
    runner = new SeriesRunner(
      p,
      async (r) => {
        const job = completed(r);
        job.status = "WORKER_ERROR";
        job.error = "decode failed";
        job.results = job.results!.slice(0, 1);
        runner.known(job);
        return job;
      },
      () => {},
    );
    await runner.start();
    expect(runner.state).toBe("failed");
    expect(runner.cells.get("image-0")?.result).toBeDefined();
    expect(runner.cells.get("image-4")?.status).toBe("pending");
  });
  it("cancels a late-accepted request once and does not dispatch more", async () => {
    let runner: SeriesRunner;
    const cancel = vi.fn(async () => {}),
      p = planSeries(input, 8, 4);
    runner = new SeriesRunner(
      p,
      async (r) => {
        runner.cancel();
        const job = completed(r);
        runner.known(job);
        runner.known(job);
        return job;
      },
      () => {},
      cancel,
    );
    await runner.start();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(runner.completed).toBe(4);
    expect(runner.state).toBe("stopped");
  });
});

it("planned byte counts exactly match dispatched JSON with Unicode and 64-bit seed wrap", () => {
  const p = planSeries(
    {
      ...input,
      prompt: "A fox 🌍",
      images: ["AAAA", "AA=="],
      seed: MAX_SEED.toString(),
    },
    5,
    4,
  );
  for (const r of p.requests) expect(r.bytes).toBe(r.prepared.bytes);
  const grid = planGrid(
    { ...input, prompt: "A fox 🌍", images: ["AAAA"] },
    "seed",
    "9223372036854775807,0",
    "cfg",
    "1,2",
    "soft blur",
    4,
  );
  for (const r of grid.requests) expect(r.bytes).toBe(r.prepared.bytes);
});
it("reconciles a manually resumed job without submitting the remaining series", async () => {
  const p = planSeries(input, 8, 4);
  let runner: SeriesRunner, known: SavedJob;
  const execute = vi.fn(async (r: any) => {
    known = completed(r);
    known.status = "IN_PROGRESS";
    known.results = undefined;
    runner.known(known);
    throw new TypeError("Polling interrupted");
  });
  runner = new SeriesRunner(p, execute, () => {});
  await runner.start();
  const recovered = completed(p.requests[0]);
  runner.reconcile(recovered);
  expect(runner.completed).toBe(4);
  expect(runner.state).toBe("stopped");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(runner.cells.get("image-4")?.status).toBe("pending");
});

it("keeps seed validation failures visible when the terminal job is shown again", async () => {
  const p = planSeries(input, 8, 4);
  let runner: SeriesRunner, saved: SavedJob;
  runner = new SeriesRunner(
    p,
    async (r) => {
      saved = completed(r);
      saved.results![0].seed = "999";
      runner.known(saved);
      return saved;
    },
    () => {},
  );
  await runner.start();
  runner.reconcile(saved!);
  expect(runner.state).toBe("failed");
  expect(runner.error).toContain("expected 100");
});

it("maps partial batches by seed, retains their images and leaves later requests unsent", async () => {
  const plan = planSeries(input, 8, 4);
  const execute = vi.fn(async (request) => {
    const job = completed(request);
    job.results = [job.results![1], job.results![3]];
    job.warning = "Returned 2 of 4 images to fit the response limit.";
    return job;
  });
  const runner = new SeriesRunner(plan, execute, () => {});
  await runner.start();
  expect(execute).toHaveBeenCalledTimes(1);
  expect(runner.state).toBe("stopped");
  expect(runner.completed).toBe(2);
  expect(runner.cells.get("image-0")?.status).toBe("omitted");
  expect(runner.cells.get("image-1")?.result?.seed).toBe("101");
  expect(runner.cells.get("image-3")?.result?.seed).toBe("103");
  expect(runner.cells.get("image-4")?.status).toBe("pending");
  expect(runner.error).toContain("Remaining requests were not submitted");
});
