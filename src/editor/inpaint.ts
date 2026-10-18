import {
  canvasBlob,
  loadReference,
  releaseReference,
  type Reference,
} from "../references/images";
import {
  maskBounds,
  transformFor,
  compositePixels,
  type Transform,
} from "./geometry";

export function canvas(width: number, height: number): HTMLCanvasElement {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element;
}
export function alphaOf(mask: HTMLCanvasElement): Uint8Array {
  const data = mask
    .getContext("2d", { willReadFrequently: true })!
    .getImageData(0, 0, mask.width, mask.height).data;
  const alpha = new Uint8Array(mask.width * mask.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  return alpha;
}
export function putAlpha(mask: HTMLCanvasElement, alpha: Uint8Array): void {
  const data = new ImageData(mask.width, mask.height);
  for (let i = 0; i < alpha.length; i++) {
    data.data[i * 4] = 197;
    data.data[i * 4 + 1] = 241;
    data.data[i * 4 + 2] = 107;
    data.data[i * 4 + 3] = alpha[i];
  }
  mask.getContext("2d")!.putImageData(data, 0, 0);
}
export interface InpaintSnapshot {
  source: Blob;
  mask: Blob;
  transform: Transform;
  placement?: { x: number; y: number; width: number; height: number };
}
export interface PreparedInpaint {
  references: Reference[];
  snapshot: InpaintSnapshot;
}
export async function prepareInpaint(
  source: HTMLCanvasElement,
  mask: HTMLCanvasElement,
  width: number,
  height: number,
  crop: boolean,
  padding: number,
  feather: number,
  colouredOverlay?: HTMLCanvasElement,
): Promise<PreparedInpaint> {
  const alpha = alphaOf(mask),
    bounds = maskBounds(alpha, mask.width, mask.height);
  if (!bounds) throw new Error("Paint an editable area before generating.");
  const transform = transformFor(
    source.width,
    source.height,
    width,
    height,
    crop ? bounds : null,
    padding + feather * 3,
  );
  const prepared = canvas(width, height),
    ctx = prepared.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  const { crop: rect, scale, padX, padY } = transform;
  ctx.clearRect(padX, padY, rect.width * scale, rect.height * scale);
  ctx.drawImage(
    source,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    padX,
    padY,
    rect.width * scale,
    rect.height * scale,
  );
  const base = await canvasBlob(prepared);
  const guide = canvas(width, height),
    guideCtx = guide.getContext("2d")!;
  guideCtx.drawImage(prepared, 0, 0);
  const overlay = canvas(source.width, source.height),
    overlayCtx = overlay.getContext("2d")!;
  overlayCtx.drawImage(colouredOverlay || mask, 0, 0);
  if (!colouredOverlay) {
    overlayCtx.globalCompositeOperation = "source-in";
    overlayCtx.fillStyle = "#ff304b";
    overlayCtx.fillRect(0, 0, source.width, source.height);
  }
  guideCtx.globalAlpha = 0.72;
  guideCtx.drawImage(
    overlay,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    padX,
    padY,
    rect.width * scale,
    rect.height * scale,
  );
  const finalMask = canvas(mask.width, mask.height),
    maskCtx = finalMask.getContext("2d")!;
  if (feather) maskCtx.filter = `blur(${feather}px)`;
  maskCtx.drawImage(mask, 0, 0);
  const references: Reference[] = [];
  try {
    references.push(await loadReference(base, "Inpaint source"));
    references.push(
      await loadReference(await canvasBlob(guide), "Coloured edit-area guide"),
    );
    return {
      references,
      snapshot: {
        source: await canvasBlob(source),
        mask: await canvasBlob(finalMask),
        transform,
      },
    };
  } catch (error) {
    references.forEach(releaseReference);
    throw error;
  } finally {
    for (const c of [prepared, guide, overlay, finalMask])
      c.width = c.height = 1;
  }
}
export async function composite(
  snapshot: InpaintSnapshot,
  result: Blob,
): Promise<Blob> {
  const bitmaps: ImageBitmap[] = [];
  const canvases: HTMLCanvasElement[] = [];
  try {
    for (const blob of [snapshot.source, snapshot.mask, result])
      bitmaps.push(await createImageBitmap(blob));
    const [source, mask, generated] = bitmaps,
      t = snapshot.transform;
    // The worker may downscale to fit its inline response limit. Accept a
    // proportional reduction (including integer rounding), then map the crop
    // in the returned image's coordinates. Keep unrelated shape errors visible.
    if (
      generated.width > t.width || generated.height > t.height ||
      Math.abs(generated.width * t.height - generated.height * t.width) >
        Math.max(t.width, t.height)
    )
      throw new Error(
        "Worker result dimensions do not match the inpaint request.",
      );
    if (mask.width !== source.width || mask.height !== source.height)
      throw new Error("Composite mask dimensions differ from the source.");
    const resultScaleX = generated.width / t.width,
      resultScaleY = generated.height / t.height;
    const original = canvas(source.width, source.height),
      edited = canvas(source.width, 128),
      maskCanvas = canvas(source.width, 128);
    canvases.push(original, edited, maskCanvas);
    const ctx = original.getContext("2d", { willReadFrequently: true })!,
      editCtx = edited.getContext("2d", { willReadFrequently: true })!,
      maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(source, 0, 0);
    for (let y = 0; y < source.height; y += 128) {
      const h = Math.min(128, source.height - y);
      editCtx.setTransform(1, 0, 0, 1, 0, -y);
      editCtx.clearRect(0, y, source.width, 128);
      editCtx.drawImage(source, 0, 0);
      editCtx.clearRect(t.crop.x, t.crop.y, t.crop.width, t.crop.height);
      editCtx.drawImage(
        generated,
        t.padX * resultScaleX,
        t.padY * resultScaleY,
        t.crop.width * t.scale * resultScaleX,
        t.crop.height * t.scale * resultScaleY,
        t.crop.x,
        t.crop.y,
        t.crop.width,
        t.crop.height,
      );
      maskCtx.clearRect(0, 0, source.width, 128);
      maskCtx.drawImage(mask, 0, -y);
      const rgba = maskCtx.getImageData(0, 0, source.width, h).data,
        alpha = new Uint8Array(source.width * h);
      for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
      const pixels = compositePixels(
        ctx.getImageData(0, y, source.width, h).data,
        editCtx.getImageData(0, 0, source.width, h).data,
        alpha,
      );
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(pixels), source.width, h),
        0,
        y,
      );
      // Give touch/scroll/paint events a turn during large local composites.
      if (y % 1024 === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return await canvasBlob(original);
  } finally {
    bitmaps.forEach((b) => b.close());
    canvases.forEach((c) => {
      c.width = c.height = 1;
    });
  }
}
