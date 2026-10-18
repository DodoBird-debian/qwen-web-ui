import { uid } from "../lib/dom";

export interface Reference {
  id: string;
  name: string;
  alias?: string;
  role?: string;
  blob: Blob;
  url: string;
  width: number;
  height: number;
  base64: string;
}
const u32 = (view: DataView, offset: number) => view.getUint32(offset, false);
export function inspectImage(buffer: ArrayBuffer): {
  width: number;
  height: number;
  mime: string;
} {
  const view = new DataView(buffer),
    data = new Uint8Array(buffer);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...data.subarray(offset, offset + length));
  if (data.length < 24) throw new Error("Image file is incomplete.");
  if (u32(view, 0) === 0x89504e47 && ascii(4, 4) === "\r\n\x1a\n") {
    let offset = 8;
    while (offset + 12 <= data.length) {
      const length = u32(view, offset),
        type = ascii(offset + 4, 4);
      if (type === "acTL")
        throw new Error("Animated PNG references are not supported.");
      if (length > data.length - offset - 12)
        throw new Error("Invalid PNG chunk.");
      offset += length + 12;
    }
    return { width: u32(view, 16), height: u32(view, 20), mime: "image/png" };
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    let offset = 12,
      width = 0,
      height = 0;
    while (offset + 8 <= data.length) {
      const type = ascii(offset, 4),
        size = view.getUint32(offset + 4, true),
        start = offset + 8;
      if (start + size > data.length) throw new Error("Invalid WebP chunk.");
      if (type === "ANIM" || type === "ANMF")
        throw new Error("Animated WebP references are not supported.");
      if (type === "VP8X" && size >= 10) {
        if (data[start] & 2)
          throw new Error("Animated WebP references are not supported.");
        width =
          1 +
          data[start + 4] +
          (data[start + 5] << 8) +
          (data[start + 6] << 16);
        height =
          1 +
          data[start + 7] +
          (data[start + 8] << 8) +
          (data[start + 9] << 16);
      } else if (!width && type === "VP8 " && size >= 10) {
        width = view.getUint16(start + 6, true) & 0x3fff;
        height = view.getUint16(start + 8, true) & 0x3fff;
      } else if (!width && type === "VP8L" && size >= 5) {
        const bits = view.getUint32(start + 1, true);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
      offset = start + size + (size % 2);
    }
    if (width && height) return { width, height, mime: "image/webp" };
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2,
      dimensions: { width: number; height: number; mime: string } | undefined;
    while (offset + 4 < data.length) {
      if (data[offset++] !== 0xff) throw new Error("Invalid JPEG marker.");
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker >= 0xd0 && marker <= 0xd7) continue;
      const size = view.getUint16(offset, false);
      if (size < 2 || offset + size > data.length)
        throw new Error("Invalid JPEG segment.");
      if (marker === 0xe2 && ascii(offset + 2, 4) === "MPF\0")
        throw new Error("Multi-picture JPEG references are not supported.");
      if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8)
        dimensions = {
          width: view.getUint16(offset + 5),
          height: view.getUint16(offset + 3),
          mime: "image/jpeg",
        };
      offset += size;
    }
    if (dimensions) return dimensions;
  }
  throw new Error("Use a single-frame PNG, JPEG or WebP image.");
}
export function validateSize(width: number, height: number): void {
  if (!width || !height || width * height > 20_000_000)
    throw new Error("Each reference must be at most 20 million pixels.");
  if (Math.max(width, height) > Math.min(width, height) * 100)
    throw new Error("Reference aspect ratio must be at most 100:1.");
}
export function validateReferences(references: Reference[]): void {
  if (references.length > 10)
    throw new Error(
      "At most ten reference images are supported, including inpaint guides.",
    );
  if (
    references.reduce((sum, image) => sum + image.width * image.height, 0) >
    40_000_000
  )
    throw new Error(
      "Reference images exceed 40 million decoded pixels combined.",
    );
}
export async function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read image."));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(blob);
  });
}
export async function loadReference(
  blob: Blob,
  name: string,
  id = uid(),
): Promise<Reference> {
  if (blob.size > 50_000_000)
    throw new Error(
      "Image files must be smaller than 50 MB before processing.",
    );
  const buffer = await blob.arrayBuffer(),
    header = inspectImage(buffer);
  validateSize(header.width, header.height);
  const typedBlob = new Blob([buffer], { type: header.mime });
  const bitmap = await createImageBitmap(typedBlob, {
    imageOrientation: "from-image",
  });
  const width = bitmap.width,
    height = bitmap.height;
  bitmap.close();
  validateSize(width, height);
  return {
    id,
    name,
    blob: typedBlob,
    url: URL.createObjectURL(typedBlob),
    width,
    height,
    base64: await toBase64(typedBlob),
  };
}
export function releaseReference(reference: Reference): void {
  URL.revokeObjectURL(reference.url);
}
export async function fromBase64(
  value: string,
  name: string,
): Promise<Reference> {
  const base64 = value.startsWith("data:")
    ? value.slice(value.indexOf(",") + 1)
    : value;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4)
    throw new Error("Invalid image base64.");
  const bytes = Uint8Array.from(atob(base64), (character) =>
    character.charCodeAt(0),
  );
  return loadReference(new Blob([bytes]), name);
}
export async function canvasBlob(
  canvas: HTMLCanvasElement,
  mime = "image/png",
  quality = 0.95,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Image encoding failed.")),
      mime,
      quality,
    ),
  );
}
export async function resizeReference(
  reference: Reference,
  maxSide: number,
  format: "png" | "jpeg" | "webp",
  quality: number,
): Promise<Reference> {
  const bitmap = await createImageBitmap(reference.blob, {
    imageOrientation: "from-image",
  });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d")!;
  if (format === "jpeg") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const resized = await loadReference(
    await canvasBlob(canvas, `image/${format}`, quality / 100),
    reference.name,
    reference.id,
  );
  return { ...resized, alias: reference.alias, role: reference.role };
}
