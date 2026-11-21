import { button, node, download, bytesLabel } from "../lib/dom";
import { LatestPreview } from "../resources/latest-preview";
import {
  encodeExport,
  type EncodedExport,
  type ExportOptions,
  safeFilename,
} from "./encode";
export function openExport(source: Blob, name: string) {
  const dialog = node("dialog", "export-dialog"),
    title = node("h2", "", "Prepare export"),
    close = button("Close", () => dialog.close(), "text-button");
  dialog.innerHTML = `<div class="export-fields"><label class="field">Format<select data-format><option value="png">PNG · lossless</option><option value="webp">WebP · quality controlled</option><option value="jpeg">JPEG · opaque</option></select></label><label class="field">Quality <output data-quality-value>95</output><input data-quality type="range" min="1" max="100" value="95"></label><label><input data-trim type="checkbox"> Trim transparent margins</label><label><input data-resize type="checkbox"> Resize explicitly</label><div class="field-row"><label class="field">Width<input data-width type="number" min="1" max="16384"></label><label class="field">Height<input data-height type="number" min="1" max="16384"></label></div><label><input data-flatten type="checkbox"> Flatten transparency for JPEG</label><label class="field">Background<input data-background type="color" value="#ffffff"></label><label class="field">Target size (MB, optional)<input data-target type="number" min="0.001" step="0.1" placeholder="No target"></label><p>Local export only. Raw worker files remain unchanged. Resizing can change aspect ratio; set both dimensions deliberately.</p></div>`;
  dialog.prepend(title, close);
  const status = node("p", "notice"),
    image = node("img", "export-preview"),
    actions = node("div", "button-row");
  dialog.append(status, image, actions);
  document.body.append(dialog);
  let backdropPress = false;
  const outside = (event: MouseEvent) => {
    const bounds = dialog.getBoundingClientRect();
    return (
      event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom
    );
  };
  dialog.addEventListener("pointerdown", (event) => {
    backdropPress = event.target === dialog && outside(event);
  });
  dialog.addEventListener("click", (event) => {
    if (backdropPress && event.target === dialog && outside(event)) dialog.close();
    backdropPress = false;
  });
  const q = <T extends HTMLInputElement | HTMLSelectElement>(key: string) =>
    dialog.querySelector<T>(`[data-${key}]`)!;
  let prepared: EncodedExport | undefined,
    url = "";
  const save = button("Download export", () => {
    if (!prepared) return;
    download(
      prepared.blob,
      `${safeFilename(name)}-export.${q("format").value}`,
    );
  });
  save.disabled = true;
  function invalidate() {
    prepared = undefined;
    save.disabled = true;
    status.textContent = "Preparing preview…";
    image.hidden = true;
    image.removeAttribute("src");
    if (url) URL.revokeObjectURL(url);
    url = "";
    task.invalidate();
    q<HTMLInputElement>("quality").disabled = q("format").value === "png";
    dialog.querySelector("[data-quality-value]")!.textContent =
      q("quality").value;
    for (const key of ["width", "height"])
      q<HTMLInputElement>(key).disabled =
        !q<HTMLInputElement>("resize").checked;
  }
  dialog.addEventListener("input", invalidate);
  dialog.addEventListener("change", invalidate);
  const preview = button("Preview export", () => task.run());
  const task = new LatestPreview<EncodedExport>({
    encode: async signal => {
      const o: ExportOptions = {
        format: q("format").value as ExportOptions["format"],
        quality: Number(q("quality").value),
        trim: q<HTMLInputElement>("trim").checked,
        background: q<HTMLInputElement>("flatten").checked
          ? q("background").value
          : undefined,
        targetBytes: q("target").value
          ? Number(q("target").value) * 1_000_000
          : undefined,
        ...(q<HTMLInputElement>("resize").checked
          ? {
              width: Number(q("width").value),
              height: Number(q("height").value),
            }
          : {}),
      };
      return encodeExport(source, o, signal);
    },
    pending: () => {
      prepared = undefined;
      save.disabled = true;
      preview.disabled = true;
      status.textContent = "Encoding in your browser…";
    },
    ready: result => {
      prepared = result;
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(result.blob);
      image.src = url;
      image.hidden = false;
      const format = q("format").value;
      status.textContent = `${result.width} × ${result.height} · ${bytesLabel(result.blob.size)} (${result.blob.size.toLocaleString()} bytes) · ${result.blob.type}${format === "png" ? "" : ` · quality ${result.quality}`} · ${result.hasAlpha ? (format === "jpeg" ? "alpha flattened" : "alpha retained") : "opaque source"}`;
      save.disabled = false;
      preview.disabled = false;
    },
    discard: () => {},
    error: error => {
      status.textContent = error instanceof Error ? error.message : String(error);
      preview.disabled = false;
    },
  });
  actions.append(preview, save);
  dialog.addEventListener(
    "close",
    () => {
      task.close();
      if (url) URL.revokeObjectURL(url);
      dialog.remove();
    },
    { once: true },
  );
  void createImageBitmap(source)
    .then((b) => {
      if (dialog.isConnected && !q("width").value && !q("height").value) {
        q("width").value = String(b.width);
        q("height").value = String(b.height);
        invalidate();
      }
      b.close();
    })
    .catch(() => {});
  invalidate();
  dialog.showModal();
}
