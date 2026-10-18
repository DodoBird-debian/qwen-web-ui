import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  normalizeInput,
  prepare,
  MAX_SEED,
  MAX_REQUEST_BYTES,
  nextSeed,
} from "../../src/api/contract";
import { json, parseJson } from "../../src/api/json";
const valid = () => ({ ...DEFAULTS, prompt: "A ceramic fox" });
describe("frozen request contract", () => {
  it("normalizes defaults and native aspect sizes", () => {
    expect(normalizeInput({ prompt: " x " }).width).toBe(1024);
    expect(normalizeInput({ prompt: "x", aspect_ratio: "1:1" }).width).toBe(
      2048,
    );
    expect(normalizeInput({ prompt: " x " }).prompt).toBe("x");
  });
  it.each([
    { width: 1024 },
    { width: 256, height: 257 },
    { width: 4096, height: 4096 },
    { aspect_ratio: "1:1", width: 1024, height: 1024 },
  ])("rejects incompatible dimensions %j", (patch) =>
    expect(() => normalizeInput({ prompt: "x", ...patch })).toThrow(),
  );
  it.each(["mask", "mask_image", "strength", "guidance_scale"])(
    "does not extend worker with %s",
    (field) =>
      expect(() => normalizeInput({ ...valid(), [field]: 1 })).toThrow(
        "Unknown",
      ),
  );
  it("enforces CFG/negative and alpha/format combinations", () => {
    expect(() => normalizeInput({ ...valid(), negative_prompt: "x" })).toThrow(
      "CFG",
    );
    expect(
      normalizeInput({ ...valid(), true_cfg_scale: 2 }).negative_prompt,
    ).toBe("");
    expect(() =>
      normalizeInput({ ...valid(), transparent: true, output_format: "jpeg" }),
    ).toThrow("Transparency");
  });
  it.each([NaN, Infinity, 0, 20.1, true])(
    "rejects invalid CFG %j",
    (true_cfg_scale) =>
      expect(() => normalizeInput({ ...valid(), true_cfg_scale })).toThrow(),
  );
  it("counts code points and rejects lone Unicode surrogates", () => {
    expect(normalizeInput({ prompt: "🎨".repeat(20_000) }).prompt.length).toBe(
      40_000,
    );
    expect(() => normalizeInput({ prompt: "\ud800" })).toThrow("Unicode");
    expect(() => normalizeInput({ prompt: "\udfff" })).toThrow("Unicode");
    expect(() => normalizeInput({ prompt: "x".repeat(20_001) })).toThrow();
  });
  it("round trips unsafe seeds as numeric JSON without loss", () => {
    const prepared = prepare({ ...valid(), seed: MAX_SEED.toString() });
    expect(prepared.body).toContain('"seed":9223372036854775807');
    expect(normalizeInput(parseJson(prepared.body).input).seed).toBe(
      MAX_SEED.toString(),
    );
    expect(json(parseJson('{"seed":9007199254740993}'))).toBe(
      '{"seed":9007199254740993}',
    );
    expect(() =>
      normalizeInput({ ...valid(), seed: Number(MAX_SEED) }),
    ).toThrow("exact");
    expect(nextSeed(MAX_SEED.toString(), 1)).toBe("0");
  });
  it("checks exactly the final UTF-8 body at the decimal 10 MB boundary", () => {
    const baseline = prepare({ ...valid(), prompt: "日本語", images: ["A"] });
    const image = "A".repeat(MAX_REQUEST_BYTES - baseline.bytes + 1);
    expect(
      prepare({ ...valid(), prompt: "日本語", images: [image] }).bytes,
    ).toBe(MAX_REQUEST_BYTES);
    expect(() =>
      prepare({ ...valid(), prompt: "日本語", images: [image + "A"] }),
    ).toThrow("10,000,000");
  });
});
