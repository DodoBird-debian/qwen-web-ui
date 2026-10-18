import {
  alphaOf,
  canvas,
  putAlpha,
  prepareInpaint,
  type PreparedInpaint,
} from "./inpaint";
import { expandSource, expansionCoverage, type Expansion } from "./outpaint";
import { type MaskEditor } from "./mask-editor";
import { unionMasks, REGION_NAMES, REGION_COLOURS } from "./regions";
export interface EditOptions {
  width: number;
  height: number;
  crop: boolean;
  padding: number;
  feather: number;
  expansion?: Expansion;
}
export async function prepareEdit(
  editor: MaskEditor,
  o: EditOptions,
): Promise<PreparedInpaint> {
  if (!editor.loaded) throw new Error("Load an edit source first.");
  const owned: HTMLCanvasElement[] = [];
  const make = (w: number, h: number) => {
    const c = canvas(w, h);
    owned.push(c);
    return c;
  };
  try {
    const active = editor.regions.filter(
      (r) => r.enabled && editor.alpha(r.mask).some((v) => v > 0),
    );
    const mask = make(editor.source.width, editor.source.height),
      overlay = editor.guideOverlay();
    owned.push(overlay);
    const masks = active.map((r) => {
      const layer = make(mask.width, mask.height),
        ctx = layer.getContext("2d")!,
        feather = r.feather ?? o.feather;
      if (!Number.isFinite(feather) || feather < 0 || feather > 100)
        throw new Error("Region feather must be 0–100 px.");
      if (feather) ctx.filter = `blur(${feather}px)`;
      ctx.drawImage(r.mask, 0, 0);
      const alpha = alphaOf(layer);
      layer.width = layer.height = 1;
      return alpha;
    });
    putAlpha(mask, unionMasks(masks, mask.width * mask.height));
    if (!o.expansion)
      return await prepareInpaint(
        editor.source,
        mask,
        o.width,
        o.height,
        o.crop,
        o.padding,
        0,
        overlay,
      );
    const { source, placement: p } = expandSource(editor.source, o.expansion);
    owned.push(source);
    if (
      p.canvasWidth === editor.source.width &&
      p.canvasHeight === editor.source.height
    )
      throw new Error("Add an extension or turn off Extend canvas.");
    const shifted = make(source.width, source.height),
      ctx = shifted.getContext("2d")!;
    ctx.drawImage(mask, p.x, p.y);
    const combined = unionMasks(
      [alphaOf(shifted), expansionCoverage(p, o.expansion.seam)],
      source.width * source.height,
    );
    putAlpha(shifted, combined);
    const guide = make(source.width, source.height),
      g = guide.getContext("2d")!;
    const expansion = make(source.width, source.height);
    putAlpha(expansion, expansionCoverage(p, o.expansion.seam));
    const ex = expansion.getContext("2d")!;
    ex.globalCompositeOperation = "source-in";
    ex.fillStyle = "#888888";
    ex.fillRect(0, 0, source.width, source.height);
    g.drawImage(expansion, 0, 0);
    g.drawImage(overlay, p.x, p.y);
    const prepared = await prepareInpaint(
      source,
      shifted,
      o.width,
      o.height,
      false,
      o.padding,
      0,
      guide,
    );
    prepared.snapshot.placement = {
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
    };
    return prepared;
  } finally {
    owned.forEach((c) => {
      c.width = c.height = 1;
    });
  }
}

export function regionInstructions(
  editor: MaskEditor,
  extend: boolean,
): string {
  const active = editor.regions.filter(
    (r) => r.enabled && editor.alpha(r.mask).some((v) => v > 0),
  );
  if (active.length > 1 && active.some((r) => !r.instruction.trim()))
    throw new Error("Give each painted region an instruction.");
  const instructions = active.map((r, i) => {
    const colour = REGION_NAMES[REGION_COLOURS.indexOf(r.colour)] || r.colour;
    return `Region ${i + 1} (${colour}, ${r.name}): ${r.instruction.trim() || "Apply the requested edit in this area."}`;
  });
  if (extend)
    instructions.push(
      "Extend the scene naturally into the new canvas area shown by the grey guide; preserve the original composition. Coloured regions inside the original have their own edit instructions.",
    );
  return instructions.join("\n");
}
