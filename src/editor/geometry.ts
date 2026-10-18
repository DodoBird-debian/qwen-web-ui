export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Transform {
  sourceWidth: number;
  sourceHeight: number;
  crop: Rect;
  width: number;
  height: number;
  scale: number;
  padX: number;
  padY: number;
}
export function maskBounds(
  alpha: Uint8Array,
  width: number,
  height: number,
): Rect | null {
  let x0 = width,
    y0 = height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  return x1 < 0
    ? null
    : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
export function transformFor(
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
  bounds: Rect | null,
  padding: number,
): Transform {
  const crop = bounds
    ? {
        x: Math.max(0, bounds.x - padding),
        y: Math.max(0, bounds.y - padding),
        width:
          Math.min(width, bounds.x + bounds.width + padding) -
          Math.max(0, bounds.x - padding),
        height:
          Math.min(height, bounds.y + bounds.height + padding) -
          Math.max(0, bounds.y - padding),
      }
    : { x: 0, y: 0, width, height };
  const scale = Math.min(targetWidth / crop.width, targetHeight / crop.height);
  return {
    sourceWidth: width,
    sourceHeight: height,
    crop,
    width: targetWidth,
    height: targetHeight,
    scale,
    padX: (targetWidth - crop.width * scale) / 2,
    padY: (targetHeight - crop.height * scale) / 2,
  };
}
// Blend unpremultiplied RGBA; m=0 is an exact source copy, including transparent RGB.
export function compositePixels(
  source: Uint8ClampedArray,
  edited: Uint8ClampedArray,
  mask: Uint8Array,
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(source);
  for (let i = 0; i < mask.length; i++) {
    const m = mask[i] / 255,
      p = i * 4;
    if (m === 0) continue;
    const sourceA = source[p + 3] / 255,
      editedA = edited[p + 3] / 255;
    const alpha = sourceA * (1 - m) + editedA * m;
    for (let c = 0; c < 3; c++)
      result[p + c] = alpha
        ? (source[p + c] * sourceA * (1 - m) + edited[p + c] * editedA * m) /
          alpha
        : 0;
    result[p + 3] = alpha * 255;
  }
  return result;
}
