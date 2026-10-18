import { remapEditInstruction } from '../../src/references/tokens';
import { describe, it, expect } from "vitest";
import { unionMasks } from "../../src/editor/regions";
import {
  expandedPlacement,
  extendToRatio,
  expansionCoverage,
} from "../../src/editor/outpaint";
import { compilePrompt } from "../../src/references/prompt-compiler";
import { trimBounds, fitEncoded, safeFilename } from "../../src/export/encode";
import { differencePixels } from "../../src/inspection/compare";
import { MemoryRepository } from "../../src/state/repository";
import { createArchive } from "../../src/export/archive";
import { unzipSync, strFromU8 } from "fflate";
describe("browser editing and export rules", () => {
  it("unions masks without doubling opacity", () =>
    expect([
      ...unionMasks([new Uint8Array([128, 0]), new Uint8Array([128, 255])], 2),
    ]).toEqual([128, 255]));
  it("preserves the entire original by default during expansion, with opt-in inward seam", () => {
    const p = expandedPlacement(2, 2, {
        left: 1,
        right: 1,
        top: 1,
        bottom: 1,
        seam: 0,
      }),
      a = expansionCoverage(p, 0);
    expect(a[0]).toBe(255);
    expect(a[5]).toBe(0);
    expect(a[10]).toBe(0);
    expect(expansionCoverage(p, 2)[5]).toBeGreaterThan(0);
    expect(extendToRatio(400, 400, 2, "end")).toMatchObject({
      left: 400,
      right: 0,
    });
    expect(() =>
      expandedPlacement(4096, 4096, {
        left: 4096,
        right: 0,
        top: 4096,
        bottom: 0,
        seam: 0,
      }),
    ).toThrow("limit");
  });
  it("resolves aliases to the final positional image and rejects ambiguous/missing references", () => {
    const refs = [
      { id: "a", alias: "Person" },
      { id: "b", alias: "Jacket" },
    ];
    expect(compilePrompt("Use @{Jacket} on <image1>", refs)).toBe(
      "Use <image2> on <image1>",
    );
    expect(() =>
      compilePrompt("@{Person}", [...refs, { id: "c", alias: "Person" }]),
    ).toThrow("ambiguous");
    expect(() => compilePrompt("<image3>", refs)).toThrow("no attached");
  });
  it("defines transparent trim bounds, including completely empty images", () => {
    expect(trimBounds(new Uint8ClampedArray(16), 2, 2)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    const data = new Uint8ClampedArray(16);
    data[15] = 255;
    expect(trimBounds(data, 2, 2)).toEqual({ x: 1, y: 1, width: 1, height: 1 });
  });
  it("uses bounded original-pixel candidates and reports impossible size targets", async () => {
    const encoded = await fitEncoded(
      async (q) => new Blob(["x".repeat(q * 10)]),
      95,
      500,
    );
    expect(encoded.blob.size).toBeLessThanOrEqual(500);
    expect(encoded.quality).toBe(45);
    await expect(
      fitEncoded(async () => new Blob(["xxxx"]), 95, 1),
    ).rejects.toThrow("cannot fit");
  });
  it("computes alpha differences separately from visible RGB differences", () => {
    const a = new Uint8ClampedArray([255, 0, 0, 0]),
      b = new Uint8ClampedArray([0, 0, 0, 0]);
    expect([...differencePixels(a, b)]).toEqual([0, 0, 0, 255]);
    expect([
      ...differencePixels(a, new Uint8ClampedArray([0, 0, 0, 128]), true),
    ]).toEqual([128, 128, 128, 255]);
  });
  it("keeps browser session data isolated from mutable callers", async () => {
    const repo = new MemoryRepository(),
      value = { id: "x", created: 0, settings: { seed: "100" } };
    await repo.put("jobs", value);
    value.settings.seed = "200";
    expect((await repo.list("jobs"))[0].settings.seed).toBe("100");
  });
  it("exports a ZIP with safe unique names and an exact-seed manifest", async () => {
    const archive = await createArchive([
      {
        name: "../file.png",
        blob: new Blob(["image"]),
        metadata: { seed: "9223372036854775807" },
      },
      { name: "../file.png", blob: new Blob(["image2"]) },
    ]);
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    expect(Object.keys(files)).toEqual([
      "001--file.png",
      "002--file.png",
      "manifest.json",
    ]);
    expect(strFromU8(files["manifest.json"])).toContain("9223372036854775807");
    expect(safeFilename("..")).toBe("image");
  });
});

it('keeps reserved guide tags stable while remapping user images in custom edit instructions',()=>{
  const a={id:'a'},b={id:'b'};
  expect(remapEditInstruction('Edit <image1> using <image2> and <image3>',[a,b],[b,a])).toBe('Edit <image1> using <image2> and <image4>');
  expect(remapEditInstruction('<image3>',[a,b],[b])).toContain('<missing:');
});
