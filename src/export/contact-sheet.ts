import { canvasBlob } from "../references/images";
import { validateExportSize } from "./encode";
export async function contactSheet(
  items: { blob?: Blob; label: string }[],
  columns: number,
): Promise<Blob> {
  if (
    !items.length ||
    items.length > 100 ||
    !Number.isInteger(columns) ||
    columns < 1 ||
    columns > 10
  )
    throw new Error("Invalid contact sheet dimensions.");
  const tile = 256,
    labelHeight = 64,
    pad = 12,
    w = columns * (tile + pad) + pad,
    h = Math.ceil(items.length / columns) * (tile + labelHeight + pad) + pad;
  validateExportSize(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#171c16";
  ctx.fillRect(0, 0, w, h);
  ctx.font = "13px system-ui";
  for (const [i, item] of items.entries()) {
    const x = pad + (i % columns) * (tile + pad),
      y = pad + Math.floor(i / columns) * (tile + labelHeight + pad);
    ctx.fillStyle = "#30372d";
    ctx.fillRect(x, y, tile, tile);
    if (item.blob) {
      const b = await createImageBitmap(item.blob);
      try {
        const s = Math.min(tile / b.width, tile / b.height);
        ctx.drawImage(
          b,
          x + (tile - b.width * s) / 2,
          y + (tile - b.height * s) / 2,
          b.width * s,
          b.height * s,
        );
      } finally {
        b.close();
      }
    }
    ctx.fillStyle = "#e1edd5";
    const words = item.label.split(" ");
    let line = "",
      row = 0;
    for (const word of words) {
      if (ctx.measureText(`${line} ${word}`).width > tile && line) {
        ctx.fillText(line, x, y + tile + 18 + row * 15);
        line = word;
        row++;
        if (row === 3) break;
      } else line += (line ? " " : "") + word;
    }
    if (row < 3) ctx.fillText(line, x, y + tile + 18 + row * 15);
  }
  return canvasBlob(canvas);
}
