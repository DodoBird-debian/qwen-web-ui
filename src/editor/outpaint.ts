import { canvas } from "./inpaint";
export interface Expansion {
  left: number;
  right: number;
  top: number;
  bottom: number;
  seam: number;
}
export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
  canvasWidth: number;
  canvasHeight: number;
}
export function expandedPlacement(
  width: number,
  height: number,
  e: Expansion,
): Placement {
  for (const v of [e.left, e.right, e.top, e.bottom, e.seam])
    if (!Number.isInteger(v) || v < 0 || v > 4096)
      throw new Error(
        "Expansion and seam must be whole pixels from 0 to 4096.",
      );
  const w = width + e.left + e.right,
    h = height + e.top + e.bottom;
  if (w * h > 20_000_000 || w > 16384 || h > 16384)
    throw new Error(
      "Expanded workspace exceeds the browser limit (20 million pixels / 16384 per side).",
    );
  return {
    x: e.left,
    y: e.top,
    width,
    height,
    canvasWidth: w,
    canvasHeight: h,
  };
}
export function extendToRatio(
  width: number,
  height: number,
  ratio: number,
  anchor: "center" | "start" | "end" = "center",
): Expansion {
  if (!Number.isFinite(ratio) || ratio <= 0)
    throw new Error("Invalid aspect ratio.");
  const w = Math.max(width, Math.ceil(height * ratio)),
    h = Math.max(height, Math.ceil(width / ratio));
  const dx = w - width,
    dy = h - height;
  const fraction = anchor === "start" ? 0 : anchor === "end" ? 1 : 0.5;
  const left = Math.floor(dx * fraction),
    top = Math.floor(dy * fraction);
  return { left, right: dx - left, top, bottom: dy - top, seam: 0 };
}
export function expandSource(source: HTMLCanvasElement, e: Expansion) {
  const p = expandedPlacement(source.width, source.height, e),
    expanded = canvas(p.canvasWidth, p.canvasHeight);
  expanded.getContext("2d")!.drawImage(source, p.x, p.y);
  return { source: expanded, placement: p };
}
export function expansionCoverage(p: Placement, seam: number): Uint8Array {
  const a = new Uint8Array(p.canvasWidth * p.canvasHeight);
  for (let y = 0; y < p.canvasHeight; y++)
    for (let x = 0; x < p.canvasWidth; x++) {
      const inside =
        x >= p.x && x < p.x + p.width && y >= p.y && y < p.y + p.height;
      const d = Math.min(
        x - p.x,
        p.x + p.width - 1 - x,
        y - p.y,
        p.y + p.height - 1 - y,
      );
      a[y * p.canvasWidth + x] = !inside
        ? 255
        : seam
          ? Math.round(255 * Math.max(0, 1 - (d + 1) / seam))
          : 0;
    }
  return a;
}
