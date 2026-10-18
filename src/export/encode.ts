import { canvasBlob } from "../references/images";
export type ExportFormat = "png" | "webp" | "jpeg";
export interface ExportOptions {
  format: ExportFormat;
  quality: number;
  width?: number;
  height?: number;
  trim: boolean;
  background?: string;
  targetBytes?: number;
}
export interface EncodedExport {
  blob: Blob;
  width: number;
  height: number;
  quality: number;
  hasAlpha: boolean;
  trimmed: { x: number; y: number; width: number; height: number };
}
export function trimBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
) {
  let x0 = width,
    y0 = height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  return x1 < 0
    ? { x: 0, y: 0, width: 1, height: 1 }
    : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
export function validateExportSize(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 16384 ||
    width * height > 20_000_000
  )
    throw new Error(
      "Export dimensions must be positive whole pixels, at most 20 million pixels / 16384 per side.",
    );
}
/** Always encode from original pixels, never from a preceding lossy candidate. */
export async function fitEncoded(
  encode: (quality: number) => Promise<Blob>,
  quality: number,
  target?: number,
  signal?: AbortSignal,
): Promise<{ blob: Blob; quality: number }> {
  if (!Number.isInteger(quality) || quality < 1 || quality > 100)
    throw new Error("Quality must be an integer from 1 to 100.");
  if (target !== undefined && (!Number.isFinite(target) || target < 1))
    throw new Error("Target size must be positive.");
  signal?.throwIfAborted();
  let best: { blob: Blob; quality: number } | undefined;
  const first = await encode(quality);
  signal?.throwIfAborted();
  if (!target || first.size <= target) return { blob: first, quality };
  if (!Number.isFinite(target) || target < 1)
    throw new Error("Target size must be positive.");
  // A bounded ladder is robust to non-monotonic encoder sizes; retain highest fitting quality.
  const levels = [
    ...new Set([
      quality,
      ...Array.from({ length: 10 }, (_, i) =>
        Math.max(1, quality - (i + 1) * 10),
      ),
      1,
    ]),
  ];
  for (const q of levels.slice(1)) {
    signal?.throwIfAborted();
    const blob = await encode(q);
    signal?.throwIfAborted();
    if (blob.size <= target && (!best || q > best.quality)) {
      best = { blob, quality: q };
      break;
    }
  }
  if (!best)
    throw new Error(
      "The target cannot fit at these dimensions. Increase the target or explicitly choose smaller dimensions.",
    );
  return best;
}
export async function encodeExport(
  source: Blob,
  o: ExportOptions,
  signal?: AbortSignal,
): Promise<EncodedExport> {
  if (
    o.targetBytes !== undefined &&
    (!Number.isFinite(o.targetBytes) || o.targetBytes < 1)
  )
    throw new Error("Target size must be positive.");
  if (o.targetBytes !== undefined && o.targetBytes < 4)
    throw new Error(
      "The target cannot fit any supported image file. Increase the target size.",
    );
  signal?.throwIfAborted();
  const bitmap = await createImageBitmap(source);
  try {
    signal?.throwIfAborted();
    validateExportSize(bitmap.width, bitmap.height);
    const original = document.createElement("canvas");
    original.width = bitmap.width;
    original.height = bitmap.height;
    const ctx = original.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, original.width, original.height).data;
    let hasAlpha = false;
    for (let i = 3; i < data.length; i += 4)
      if (data[i] < 255) {
        hasAlpha = true;
        break;
      }
    const trim = o.trim
      ? trimBounds(data, original.width, original.height)
      : { x: 0, y: 0, width: original.width, height: original.height };
    const width = o.width ?? trim.width,
      height = o.height ?? trim.height;
    validateExportSize(width, height);
    if (o.format === "jpeg" && hasAlpha && !o.background)
      throw new Error(
        "JPEG removes transparency. Enable flattening and choose a background colour.",
      );
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const out = output.getContext("2d")!;
    if (o.format === "jpeg") {
      out.fillStyle = o.background || "#ffffff";
      out.fillRect(0, 0, width, height);
    }
    out.drawImage(
      original,
      trim.x,
      trim.y,
      trim.width,
      trim.height,
      0,
      0,
      width,
      height,
    );
    const encode = async (q: number) => {
      signal?.throwIfAborted();
      const blob = await canvasBlob(output, `image/${o.format}`, q / 100);
      if (blob.type !== `image/${o.format}`)
        throw new Error(
          `This browser cannot encode ${o.format.toUpperCase()}; choose PNG or another supported format.`,
        );
      return blob;
    };
    let result;
    if (o.format === "png") {
      const blob = await encode(100);
      if (o.targetBytes && blob.size > o.targetBytes)
        throw new Error(
          "Lossless PNG exceeds the target. Choose WebP/JPEG or explicitly reduce dimensions.",
        );
      result = { blob, quality: 100 };
    } else result = await fitEncoded(encode, o.quality, o.targetBytes, signal);
    signal?.throwIfAborted();
    return { ...result, width, height, hasAlpha, trimmed: trim };
  } finally {
    bitmap.close();
  }
}
export function safeFilename(value: string) {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^\.+/, "")
      .slice(0, 120) || "image"
  );
}
