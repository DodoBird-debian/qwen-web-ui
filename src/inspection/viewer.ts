import type { ResultImage, SavedJob } from "../api/jobs";
import { node, button, download } from "../lib/dom";
import { decodeCanvas, alignRaw, differencePixels } from "./compare";
import { json } from "../api/json";
export interface InspectItem {
  result: ResultImage;
  job: SavedJob;
  label?: string;
}
export function openViewer(
  items: InspectItem[],
  initial = 0,
  initialVariant: "raw" | "composite" = "raw",
) {
  const dialog = node("dialog", "inspector"),
    head = node("div", "dialog-heading"),
    title = node("h2", "", "Inspect result");
  head.append(
    title,
    button("Close", () => dialog.close(), "button"),
  );
  dialog.append(head);
  const tools = node("div", "inspection-tools");
  function select(label: string, options: [string, string][]) {
    const wrap = node("label", "inline-field", label + " "),
      s = node("select");
    for (const [value, text] of options) {
      const o = node("option", "", text);
      o.value = value;
      s.append(o);
    }
    wrap.append(s);
    tools.append(wrap);
    return s;
  }
  const variant = select("Image", [
    ["raw", "Raw worker output"],
    ["composite", "Local composite"],
    ["source", "Source"],
  ]);
  variant.value = initialVariant;
  const mode = select("View", [
    ["single", "Single"],
    ["slider", "Before / after slider"],
    ["side", "Side by side"],
    ["difference", "RGB difference"],
    ["alpha-difference", "Alpha difference"],
    ["alpha", "Alpha only"],
  ]);
  const background = select("Background", [
    ["checker", "Checkerboard"],
    ["light", "Light"],
    ["dark", "Dark"],
    ["custom", "Custom"],
  ]);
  const colour = node("input");
  colour.type = "color";
  colour.value = "#638aab";
  colour.setAttribute("aria-label", "Custom preview background");
  tools.append(colour);
  const wipe = node("input");
  wipe.type = "range";
  wipe.min = "0";
  wipe.max = "100";
  wipe.value = "50";
  wipe.setAttribute("aria-label", "Comparison split");
  tools.append(wipe);
  const prev = button("← Previous", () => navigate(-1)),
    next = button("Next →", () => navigate(1));
  const fit = button("Fit", () => {
      zoom = 1;
      draw();
    }),
    actual = button("100%", () => {
      zoom = 0;
      draw();
    });
  const full = button("Fullscreen", async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await dialog.requestFullscreen?.();
  });
  const exportButton = button("Prepare export", async () => {
    const { openExport } = await import("../export/dialog");
    openExport(
      currentBlob(),
      `qwen-${items[index].result.seed}-${variant.value}`,
    );
  });
  const rawDownload = button("Download raw", () =>
    download(
      items[index].result.blob,
      `qwen-${items[index].result.seed}.${items[index].result.mime.split("/")[1]}`,
    ),
  );
  tools.append(prev, next, fit, actual, full, rawDownload, exportButton);
  dialog.append(tools);
  const status = node("p", "notice"),
    viewport = node("div", "inspection-viewport checkerboard"),
    stage = node("div", "inspection-stage"),
    canvas = node("canvas"),
    metadata = node("pre", "inspection-metadata");
  stage.append(canvas);
  viewport.append(stage);
  dialog.append(status, viewport, metadata);
  document.body.append(dialog);
  let index = initial,
    zoom = 1,
    token = 0,
    primary: HTMLCanvasElement | undefined,
    before: HTMLCanvasElement | undefined,
    aligned: HTMLCanvasElement | undefined,
    active = true;
  function currentBlob() {
    const item = items[index];
    return variant.value === "source"
      ? item.job.inpaint!.source
      : variant.value === "composite"
        ? item.result.composite!
        : item.result.blob;
  }
  async function load() {
    const generation = ++token,
      item = items[index];
    primary = before = aligned = undefined;
    variant.querySelector<HTMLOptionElement>("[value=composite]")!.disabled =
      !item.result.composite;
    variant.querySelector<HTMLOptionElement>("[value=source]")!.disabled =
      !item.job.inpaint;
    if (
      (variant.value === "composite" && !item.result.composite) ||
      (variant.value === "source" && !item.job.inpaint)
    )
      variant.value = "raw";
    for (const option of mode.options)
      option.disabled =
        !item.job.inpaint &&
        ["slider", "side", "difference", "alpha-difference"].includes(
          option.value,
        );
    if (mode.selectedOptions[0].disabled) mode.value = "single";
    title.textContent = `${index + 1} / ${items.length} · ${item.label || `Seed ${item.result.seed}`}`;
    const { images: _, ...input } = item.job.input;
    metadata.textContent = json(
      {
        seed: item.result.seed,
        jobId: item.job.runpodId,
        endpoint: item.job.endpoint,
        raw: {
          width: item.result.width,
          height: item.result.height,
          mime: item.result.mime,
          bytes: item.result.blob.size,
        },
        input,
        label: item.label,
        editTransform: item.job.inpaint?.transform,
        originalPlacement: item.job.inpaint?.placement,
      },
      true,
    );
    try {
      const p = await decodeCanvas(currentBlob());
      if (!active || generation !== token) return;
      let b: HTMLCanvasElement | undefined, a: HTMLCanvasElement | undefined;
      if (
        item.job.inpaint &&
        ["slider", "side", "difference", "alpha-difference"].includes(
          mode.value,
        )
      ) {
        b = await decodeCanvas(item.job.inpaint.source);
        a =
          variant.value === "raw"
            ? await alignRaw(item.result.blob, item.job.inpaint)
            : p;
      }
      if (!active || generation !== token) return;
      primary = p;
      before = b;
      aligned = a;
      const px = p.getContext("2d")!.getImageData(0, 0, p.width, p.height).data;
      let alpha = false;
      for (let i = 3; i < px.length; i += 4)
        if (px[i] < 255) {
          alpha = true;
          break;
        }
      status.textContent = `${variant.selectedOptions[0].text} · ${p.width} × ${p.height} · ${alpha ? "Contains transparent pixels" : "Fully opaque pixels"}${item.job.inpaint && variant.value === "raw" && before ? " · Raw comparison mapped to source coordinates; outside a generated crop has no raw data." : ""}`;
      draw();
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : String(e);
    }
  }
  let paintKey = "";
  function draw() {
    if (!primary) return;
    let p = aligned || primary;
    const compare = before && aligned;
    const side = mode.value === "side" && compare;
    const key = `${token}:${mode.value}:${wipe.value}`;
    if (key !== paintKey) {
      if (
        p.width * (side ? 2 : 1) > 32767 ||
        p.width * p.height * (side ? 2 : 1) > 40_000_000
      ) {
        status.textContent =
          "This comparison is too large. Choose the slider or single-image view.";
        return;
      }
      paintKey = key;
      canvas.width = p.width * (side ? 2 : 1);
      canvas.height = p.height;
      const ctx = canvas.getContext("2d")!;
      if (mode.value === "alpha") {
        const pixels = p
          .getContext("2d")!
          .getImageData(0, 0, p.width, p.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const a = pixels.data[i + 3];
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = a;
          pixels.data[i + 3] = 255;
        }
        ctx.putImageData(pixels, 0, 0);
      } else if (
        compare &&
        ["difference", "alpha-difference"].includes(mode.value)
      ) {
        const a = before!
            .getContext("2d")!
            .getImageData(0, 0, p.width, p.height),
          b = p.getContext("2d")!.getImageData(0, 0, p.width, p.height);
        ctx.putImageData(
          new ImageData(
            differencePixels(a.data, b.data, mode.value === "alpha-difference"),
            p.width,
            p.height,
          ),
          0,
          0,
        );
      } else if (side) {
        ctx.drawImage(before!, 0, 0);
        ctx.drawImage(p, p.width, 0);
      } else if (compare && mode.value === "slider") {
        ctx.drawImage(before!, 0, 0);
        ctx.save();
        const split = (p.width * Number(wipe.value)) / 100;
        ctx.beginPath();
        ctx.rect(split, 0, p.width - split, p.height);
        ctx.clip();
        ctx.clearRect(split, 0, p.width - split, p.height);
        ctx.drawImage(p, 0, 0);
        ctx.restore();
        ctx.strokeStyle = "#c5f16b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(split, 0);
        ctx.lineTo(split, p.height);
        ctx.stroke();
      } else ctx.drawImage(p, 0, 0);
    }
    const fitScale = Math.min(
      1,
      Math.max(100, viewport.clientWidth - 32) / canvas.width,
      Math.max(100, viewport.clientHeight - 32) / canvas.height,
    );
    const scale = zoom === 0 ? 1 : fitScale * zoom;
    stage.style.width = `${canvas.width * scale}px`;
    stage.style.height = `${canvas.height * scale}px`;
    viewport.classList.toggle("checkerboard", background.value === "checker");
    viewport.style.backgroundColor =
      background.value === "light"
        ? "#ffffff"
        : background.value === "dark"
          ? "#101010"
          : background.value === "custom"
            ? colour.value
            : "";
    wipe.hidden = mode.value !== "slider";
    colour.hidden = background.value !== "custom";
  }
  function navigate(delta: number) {
    index = (index + delta + items.length) % items.length;
    zoom = 1;
    void load();
  }
  variant.onchange = () => {
    void load();
  };
  mode.onchange = () => {
    void load();
  };
  background.onchange = draw;
  colour.oninput = draw;
  wipe.oninput = draw;
  viewport.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom = Math.max(
        0.2,
        Math.min(16, (zoom || 1) * (e.deltaY > 0 ? 0.85 : 1.15)),
      );
      draw();
    },
    { passive: false },
  );
  const pointers = new Map<number, { x: number; y: number }>();
  let distance = 0;
  viewport.style.touchAction = "none";
  viewport.onpointerdown = (e) => {
    viewport.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  viewport.onpointermove = (e) => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()],
        d = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance)
        zoom = Math.max(0.2, Math.min(16, ((zoom || 1) * d) / distance));
      distance = d;
      draw();
    } else {
      viewport.scrollLeft -= e.clientX - last.x;
      viewport.scrollTop -= e.clientY - last.y;
    }
  };
  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    distance = 0;
  };
  viewport.onpointerup = release;
  viewport.onpointercancel = release;
  dialog.onkeydown = (e) => {
    if (
      ["INPUT", "SELECT", "TEXTAREA"].includes(
        (e.target as HTMLElement).tagName,
      )
    )
      return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      navigate(1);
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      navigate(-1);
    }
  };
  const observer = new ResizeObserver(draw);
  observer.observe(viewport);
  dialog.addEventListener(
    "close",
    () => {
      active = false;
      token++;
      observer.disconnect();
      primary = before = aligned = undefined;
      dialog.remove();
    },
    { once: true },
  );
  dialog.showModal();
  void load();
}
