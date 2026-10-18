import { describe, expect, it } from "vitest";
import { remapTags, validateTags } from "../../src/references/tokens";
import {
  maskBounds,
  transformFor,
  compositePixels,
} from "../../src/editor/geometry";
import { inspectImage } from "../../src/references/images";
describe("references and local mask composition", () => {
  it("keeps tags attached to the same image when reordered and flags removed images", () => {
    const a = { id: "a" },
      b = { id: "b" };
    expect(remapTags("Use <image1> and <image2>", [a, b], [b, a])).toBe(
      "Use <image2> and <image1>",
    );
    const removed = remapTags("<image2>", [a, b], [a]);
    expect(() => validateTags(removed, 1)).toThrow("missing");
    expect(() => validateTags("<image3>", 2)).toThrow("no attached");
  });
  it("finds mask bounds and maps a context crop into a legal padded target", () => {
    const alpha = new Uint8Array(100);
    alpha[22] = 255;
    alpha[44] = 255;
    expect(maskBounds(alpha, 10, 10)).toEqual({
      x: 2,
      y: 2,
      width: 3,
      height: 3,
    });
    const t = transformFor(
      1000,
      500,
      512,
      512,
      { x: 100, y: 100, width: 200, height: 100 },
      10,
    );
    expect(t.crop).toEqual({ x: 90, y: 90, width: 220, height: 120 });
    expect(t.padX).toBe(0);
    expect(t.padY).toBeGreaterThan(100);
    expect(maskBounds(new Uint8Array(4), 2, 2)).toBeNull();
  });
  it("preserves every source byte outside the mask and blends alpha inside", () => {
    const original = new Uint8ClampedArray([11, 22, 33, 0, 255, 0, 0, 255]);
    const edited = new Uint8ClampedArray([99, 99, 99, 255, 0, 0, 255, 128]);
    const result = compositePixels(original, edited, new Uint8Array([0, 255]));
    expect(Array.from(result)).toEqual([11, 22, 33, 0, 0, 0, 255, 128]);
    const feathered = compositePixels(
      original,
      edited,
      new Uint8Array([0, 128]),
    );
    expect(feathered[7]).toBe(191);
    expect(feathered[4]).toBeGreaterThan(feathered[6]);
  });
  it("rejects unknown image formats and animation headers before decoding", () => {
    expect(() => inspectImage(new Uint8Array(24).buffer)).toThrow(
      "single-frame",
    );
    const buffer = new ArrayBuffer(58),
      view = new DataView(buffer),
      data = new Uint8Array(buffer);
    data.set([137, 80, 78, 71, 13, 10, 26, 10]);
    view.setUint32(8, 13);
    data.set(new TextEncoder().encode("IHDR"), 12);
    view.setUint32(16, 512);
    view.setUint32(20, 512);
    view.setUint32(33, 0);
    data.set(new TextEncoder().encode("acTL"), 37);
    expect(() => inspectImage(buffer)).toThrow("Animated");
  });
});
