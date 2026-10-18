import { $, node, button, bytesLabel } from "../lib/dom";
import {
  resizeReference,
  releaseReference,
  type Reference,
} from "../references/images";

export function openReferencePreparation(
  original: Reference,
  onApply: (reference: Reference) => void,
  dialog: (title: string) => HTMLElement,
) {
  const body = dialog("Prepare reference");
  const preview = node("img", "compression-preview");
  preview.src = original.url;
  preview.alt = original.name;
  body.append(preview);
  const controls = node("div");
  controls.innerHTML = `<label class="field">Maximum side (pixels)<input id="compress-size" type="number" min="32" max="12000" value="${Math.min(2048, Math.max(original.width, original.height))}"></label><label class="field">Format<select id="compress-format"><option value="png">PNG · retains alpha</option><option value="webp">WebP · retains alpha</option><option value="jpeg">JPEG · flattens alpha on white</option></select></label><label class="field">Quality (JPEG/WebP)<input id="compress-quality" type="number" min="1" max="100" value="90"></label>`;
  const report = node(
    "p",
    "notice",
    `Original: ${bytesLabel(original.blob.size)} binary / ${bytesLabel(original.base64.length)} base64.`,
  );
  let candidate: Reference | undefined;
  const apply = button(
    "Apply prepared image",
    () => {
      if (!candidate) return;
      onApply(candidate);
      candidate = undefined;
      $<HTMLDialogElement>("#content-dialog").close();
    },
    "generate-button",
  );
  apply.disabled = true;
  const inspect = button("Preview encoding", async () => {
    const side = Number($<HTMLInputElement>("#compress-size").value),
      quality = Number($<HTMLInputElement>("#compress-quality").value);
    if (
      !Number.isInteger(side) ||
      side < 32 ||
      side > 12000 ||
      !Number.isInteger(quality) ||
      quality < 1 ||
      quality > 100
    )
      throw new Error("Enter a valid side and quality.");
    const updated = await resizeReference(
      original,
      side,
      $<HTMLSelectElement>("#compress-format").value as any,
      quality,
    );
    if (candidate) releaseReference(candidate);
    candidate = updated;
    preview.src = updated.url;
    report.textContent = `${original.width}×${original.height} → ${updated.width}×${updated.height}. Base64: ${bytesLabel(original.base64.length)} → ${bytesLabel(updated.base64.length)}.`;
    apply.disabled = false;
  });
  body.append(controls, report, inspect, apply);
  $<HTMLDialogElement>("#content-dialog").addEventListener(
    "close",
    () => {
      if (candidate) releaseReference(candidate);
    },
    { once: true },
  );
}
