import { describe, it, expect } from "vitest";
import { DEFAULTS } from "../../src/api/contract";
import { estimate, GiB } from "../../src/estimates/memory";
import {
  defaultProfile,
  normalizeProfile,
  validProfile,
} from "../../src/estimates/profile";
import { projectBatches, projectBatch } from "../../src/estimates/batching";

const sizes = [
  { width: 1024, height: 1024 },
  { width: 1024, height: 1024 },
];
const input = { ...DEFAULTS, prompt: "A vase", width: 512, height: 512 };

describe("GPU profiles and buffered batch projections", () => {
  it.each([0, 1, 5, 10])(
    "adds %i GiB once to both peaks for every physical batch size",
    (safetyGiB) => {
      for (const batch of projectBatches(input, sizes, {
        ...defaultProfile,
        safetyGiB,
      })) {
        expect(batch.memory.safePeak - batch.memory.peak).toBe(safetyGiB * GiB);
        expect(batch.memory.safeParallelPeak - batch.memory.parallelPeak).toBe(
          safetyGiB * GiB,
        );
      }
    },
  );
  it.each([-1, 0.5, 10.1, 11, NaN])(
    "rejects an invalid safety addition: %s",
    (safetyGiB) => {
      expect(validProfile({ ...defaultProfile, safetyGiB })).toBe(false);
    },
  );
  it("accepts a buffer larger than GPU capacity and reports it as over-capacity", () => {
    const profile = { ...defaultProfile, gpuGiB: 8, safetyGiB: 10 };
    expect(validProfile(profile)).toBe(true);
    expect(projectBatch(input, sizes, profile, 4).route).toBe("over-capacity");
  });
  it("migrates legacy fractional headroom conservatively and bounds it to 0–10", () => {
    expect(
      normalizeProfile({
        gpuGiB: 80,
        headroomGiB: 3.2,
        offload: "text_encoder",
      })?.safetyGiB,
    ).toBe(4);
    expect(
      normalizeProfile({ gpuGiB: 80, headroomGiB: 20, offload: "text_encoder" })
        ?.safetyGiB,
    ).toBe(10);
    expect(
      normalizeProfile({ ...defaultProfile, safetyGiB: 2.5 }),
    ).toBeUndefined();
  });
  it("scales batch tensors but shares weights and conditioning", () => {
    const projections = projectBatches(input, sizes, defaultProfile);
    expect(projections.map((batch) => batch.count)).toEqual([1, 2, 3, 4]);
    expect(projections[3].memory.parallelKv).toBe(projections[0].memory.kv * 4);
    expect(projections[3].memory.tensors.conditioning).toBe(
      projections[0].memory.tensors.conditioning,
    );
    expect(projections[3].memory.parallelPeak).toBeLessThan(
      projections[0].memory.peak * 4,
    );
  });
  it("admits a four-image preview on 24 GiB with worker model offload", () => {
    const batch = projectBatch(
      input,
      [],
      { ...defaultProfile, gpuGiB: 24, offload: "model" },
      4,
    );
    expect(batch.route).toBe("parallel");
    expect(batch.memory.safeParallelPeak).toBeLessThan(24 * GiB);
  });
  it("separates parallel, memory fallback, rejection and transport fallback", () => {
    const profile = { ...defaultProfile, gpuGiB: 80, safetyGiB: 0 };
    expect(projectBatch(input, sizes, profile, 4).route).toBe("parallel");
    const m = estimate({ ...input, num_images: 4 }, sizes, profile);
    expect(m.parallelPeak).toBeGreaterThan(m.peak);
    const midpoint = (m.peak + m.parallelPeak) / (2 * GiB);
    expect(
      projectBatch(input, sizes, { ...profile, gpuGiB: midpoint }, 4).route,
    ).toBe("sequential-memory");
    expect(
      projectBatch(
        input,
        sizes,
        { ...profile, gpuGiB: midpoint, safetyGiB: 10 },
        4,
      ).route,
    ).toBe("over-capacity");
    expect(
      projectBatch({ ...input, width: 1024, height: 1024 }, sizes, profile, 4)
        .route,
    ).toBe("sequential-output");
    expect(projectBatch(input, sizes, profile, 1).route).toBe("single");
  });
});
