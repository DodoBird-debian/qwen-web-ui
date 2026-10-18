import type { InpaintSnapshot } from "../editor/inpaint";
export async function decodeCanvas(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const c = document.createElement("canvas");
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext("2d")!.drawImage(bitmap, 0, 0);
    return c;
  } finally {
    bitmap.close();
  }
}
export async function alignRaw(blob: Blob, snapshot: InpaintSnapshot) {
  const raw = await decodeCanvas(blob),
    t = snapshot.transform;
  if (raw.width !== t.width || raw.height !== t.height)
    throw new Error(
      "Raw result dimensions do not match the recorded edit transform.",
    );
  const out = document.createElement("canvas");
  out.width = t.sourceWidth;
  out.height = t.sourceHeight;
  out
    .getContext("2d")!
    .drawImage(
      raw,
      t.padX,
      t.padY,
      t.crop.width * t.scale,
      t.crop.height * t.scale,
      t.crop.x,
      t.crop.y,
      t.crop.width,
      t.crop.height,
    );
  return out;
}
export function differencePixels(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  alphaOnly = false,
) {
  if (a.length !== b.length)
    throw new Error("Comparison pixel lengths differ.");
  const out = new Uint8ClampedArray(a.length);
  for (let i = 0; i < a.length; i += 4) {
    for (let k = 0; k < 3; k++)
      out[i + k] = alphaOnly
        ? Math.abs(a[i + 3] - b[i + 3])
        : Math.abs(
            Math.round((a[i + k] * a[i + 3]) / 255) -
              Math.round((b[i + k] * b[i + 3]) / 255),
          );
    out[i + 3] = 255;
  }
  return out;
}
