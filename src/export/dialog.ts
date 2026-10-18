import { button, node, download, bytesLabel } from "../lib/dom";
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
    url = "",
    version = 0;
  let encoding: AbortController | undefined;
  const save = button("Download export", () => {
    if (!prepared) return;
    download(
      prepared.blob,
      `${safeFilename(name)}-export.${q("format").value}`,
    );
  });
  save.disabled = true;
  function invalidate() {
    encoding?.abort();
    version++;
    prepared = undefined;
    save.disabled = true;
    status.textContent = "Preview to encode and measure the actual file.";
    q<HTMLInputElement>("quality").disabled = q("format").value === "png";
    dialog.querySelector("[data-quality-value]")!.textContent =
      q("quality").value;
    for (const key of ["width", "height"])
      q<HTMLInputElement>(key).disabled =
        !q<HTMLInputElement>("resize").checked;
  }
  dialog.addEventListener("input", invalidate);
  const preview = button("Preview export", async () => {
    const token = ++version;
    encoding?.abort();
    encoding = new AbortController();
    save.disabled = true;
    status.textContent = "Encoding in your browser…";
    preview.disabled = true;
    try {
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
      const result = await encodeExport(source, o, encoding.signal);
      if (token !== version) return;
      prepared = result;
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(result.blob);
      image.src = url;
      status.textContent = `${result.width} × ${result.height} · ${bytesLabel(result.blob.size)} (${result.blob.size.toLocaleString()} bytes) · ${result.blob.type}${o.format === "png" ? "" : ` · quality ${result.quality}`} · ${result.hasAlpha ? (o.format === "jpeg" ? "alpha flattened" : "alpha retained") : "opaque source"}`;
      save.disabled = false;
    } catch (e) {
      if (token === version)
        status.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      preview.disabled = false;
    }
  });
  actions.append(preview, save);
  dialog.addEventListener(
    "close",
    () => {
      version++;
      encoding?.abort();
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
      }
      b.close();
    })
    .catch(() => {});
  invalidate();
  dialog.showModal();
}
