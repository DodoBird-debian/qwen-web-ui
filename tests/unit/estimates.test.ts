import { describe, expect, it } from "vitest";
import fixture from "../fixtures/memory.json";
import placementFixture from "../fixtures/placement.json";
import {
  DEFAULTS,
  SOURCE_COMMIT,
  effectivePrompt,
  type Input,
} from "../../src/api/contract";
import {
  estimate,
  defaultProfile,
  roundEven,
  textBound,
  GiB,
} from "../../src/estimates/memory";
import { outputBudget } from "../../src/estimates/output";
describe("frozen worker estimator parity", () => {
  it("records source provenance and matches all 24 worker-generated phase fixtures", () => {
    expect(fixture.sourceCommit).toBe(SOURCE_COMMIT);
    for (const entry of fixture.cases) {
      const result = estimate(
          entry.input as Input,
          entry.sizes,
          defaultProfile,
        ),
        expected = entry.expected;
      expect(result.kv).toBe(expected.kv_cache_bytes);
      expect(result.parallelKv).toBe(expected.parallel_kv_cache_bytes);
      expect(result.imageTokens).toBe(expected.image_tokens);
      expect(result.tensors).toEqual({
        conditioning: expected.conditioning_bytes,
        denoising: expected.total_bytes,
        decoding: expected.decoding_bytes,
      });
      expect(result.batchTensors).toEqual({
        conditioning: expected.conditioning_bytes,
        denoising: expected.parallel_total_bytes,
        decoding: expected.parallel_decoding_bytes,
      });
    }
  });
  it("matches ties-to-even and transparency framing", () => {
    expect([2.5, 3.5, 4.5].map(roundEven)).toEqual([2, 4, 4]);
    const input = { ...DEFAULTS, prompt: "雪", transparent: true };
    expect(estimate(input, [], defaultProfile).text).toBe(
      textBound(effectivePrompt(input), 0),
    );
  });
  it.each(placementFixture.cases)(
    "matches the worker's phase weight budgeting for $offload",
    ({offload, placement_bytes}) => {
      const placement = Object.values(placement_bytes);
      const result = estimate(
        { ...DEFAULTS, prompt: "A vase", num_images: 4 },
        [],
        { ...defaultProfile, offload: offload as typeof defaultProfile.offload, safetyGiB: 0 },
      );
      for (const [index, phase] of result.sequential.entries()) {
        expect(phase.bytes - result.tensors[phase.name]).toBe(placement[index]);
        expect(
          result.parallel[index].bytes - result.batchTensors[phase.name],
        ).toBe(placement[index]);
      }
      expect(result.placement).toEqual(placement);
    },
  );
  it("keeps unknown compression uncertain and does not reject PNG from an upper bound", () => {
    expect(
      outputBudget({ ...DEFAULTS, output_format: "jpeg" }).guaranteedFit,
    ).toBe(false);
    expect(
      outputBudget({ ...DEFAULTS, width: 512, height: 512 }).guaranteedFit,
    ).toBe(true);
    expect(
      outputBudget({ ...DEFAULTS, width: 2048, height: 2048, num_images: 4 })
        .guaranteedFit,
    ).toBe(false);
  });
});
