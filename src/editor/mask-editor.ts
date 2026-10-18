import { alphaOf, putAlpha, canvas } from "./inpaint";
import { canvasBlob } from "../references/images";
import { uid } from "../lib/dom";
import {
  REGION_COLOURS,
  REGION_NAMES,
  unionMasks,
  type RegionDescription,
} from "./regions";
export type Tool = "brush" | "erase" | "rectangle" | "ellipse" | "pan";
export interface Region extends RegionDescription {
  mask: HTMLCanvasElement;
}
export interface SavedRegion extends RegionDescription {
  blob: Blob;
}
interface State {
  selected: string;
  regions: (RegionDescription & { alpha: Uint8Array })[];
}
export class MaskEditor {
  source = canvas(1, 1);
  sourceId = uid();
  regions: Region[] = [];
  selected = "";
  loaded = false;
  revision = 0;
  pixelRevision = 0;
  private alphaCache = new WeakMap<HTMLCanvasElement, Uint8Array>();
  private loadVersion = 0;
  tool: Tool = "brush";
  private strokeTool: Tool = "brush";
  brushSize = 60;
  private stage = document.createElement("div");
  private overlay = canvas(1, 1);
  private foreground = canvas(1, 1);
  private undoStack: State[] = [];
  private redoStack: State[] = [];
  private active = false;
  private pointerId?: number;
  private screenPoint = { x: 0, y: 0 };
  private start = { x: 0, y: 0 };
  private previous = { x: 0, y: 0 };
  private strokeBase?: Uint8Array;
  private zoom = 1;
  private regionListener = () => {};
  constructor(
    private viewport: HTMLElement,
    private onChange: () => void,
  ) {
    this.stage.className = "canvas-stage";
    this.overlay.className = this.foreground.className = "annotation-layer";
    this.foreground.style.pointerEvents = "none";
    this.overlay.style.pointerEvents = "none";
    this.stage.append(this.source, this.overlay);
    viewport.append(this.stage);
    new ResizeObserver(() => this.fit()).observe(viewport);
  }
  get mask() {
    return this.regions.find((r) => r.id === this.selected)!.mask;
  }
  onRegionsChange(listener: () => void) {
    this.regionListener = listener;
  }
  async load(blob: Blob, mask?: Blob) {
    const version = ++this.loadVersion;
    const bitmap = await createImageBitmap(blob, {
      imageOrientation: "from-image",
    });
    if (version !== this.loadVersion) {
      bitmap.close();
      return;
    }
    this.active = false;
    this.pointerId = undefined;
    this.source.width =
      this.overlay.width =
      this.foreground.width =
        bitmap.width;
    this.source.height =
      this.overlay.height =
      this.foreground.height =
        bitmap.height;
    this.source.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    this.regions = [];
    this.sourceId = uid();
    this.loaded = true;
    this.undoStack = [];
    this.redoStack = [];
    this.add(false);
    if (mask) {
      const image = await createImageBitmap(mask);
      if (version !== this.loadVersion) {
        image.close();
        return;
      }
      this.mask
        .getContext("2d")!
        .drawImage(image, 0, 0, this.mask.width, this.mask.height);
      image.close();
    }
    this.zoom = 1;
    this.fit();
    this.changed();
  }
  private createMask() {
    const layer = canvas(this.source.width, this.source.height);
    layer.className = "mask-layer";
    layer.tabIndex = 0;
    layer.setAttribute("aria-label", "Paint selected edit region");
    layer.style.touchAction = "none";
    layer.addEventListener("pointerdown", (e) => this.down(e));
    layer.addEventListener("pointermove", (e) => this.move(e));
    layer.addEventListener("pointerup", (e) => this.up(e));
    layer.addEventListener("pointercancel", (e) => this.up(e));
    return layer;
  }
  add(history = true) {
    if (this.active) return;
    if (!this.loaded) return;
    if (
      this.regions.length >= 8 ||
      (this.regions.length + 1) * this.source.width * this.source.height >
        40_000_000
    )
      throw new Error(
        "Region limit reached (8 regions / 40 million mask pixels).",
      );
    if (history) this.snapshot();
    const colour = REGION_COLOURS.find(
      (c) => !this.regions.some((r) => r.colour === c),
    )!;
    const id = uid();
    this.regions.push({
      id,
      name: `${REGION_NAMES[REGION_COLOURS.indexOf(colour)]} region`,
      colour,
      instruction: "",
      enabled: true,
      mask: this.createMask(),
    });
    this.selected = id;
    this.mount();
    this.changed();
  }
  select(id: string) {
    if (this.active) return;
    if (this.regions.some((r) => r.id === id)) {
      this.selected = id;
      this.mount();
      this.regionListener();
    }
  }
  update(
    id: string,
    patch: Partial<
      Pick<RegionDescription, "name" | "instruction" | "enabled" | "feather">
    >,
  ) {
    const r = this.regions.find((r) => r.id === id);
    if (!r) return;
    this.snapshot();
    Object.assign(r, patch);
    this.changed("enabled" in patch || "feather" in patch);
  }
  moveRegion(id: string, delta: number) {
    if (this.active) return;
    const i = this.regions.findIndex((r) => r.id === id),
      j = i + delta;
    if (j < 0 || j >= this.regions.length) return;
    this.snapshot();
    [this.regions[i], this.regions[j]] = [this.regions[j], this.regions[i]];
    this.changed();
  }
  remove(id: string) {
    if (this.active) return;
    if (this.regions.length === 1)
      throw new Error("Keep at least one region; use Clear to empty it.");
    this.snapshot();
    this.regions = this.regions.filter((r) => r.id !== id);
    if (this.selected === id) this.selected = this.regions[0].id;
    this.mount();
    this.changed();
  }
  private mount() {
    this.stage.querySelectorAll(".mask-layer").forEach((e) => e.remove());
    if (this.regions.length) this.stage.append(this.mask, this.foreground);
    this.redraw();
  }
  private tint(region: Region) {
    const ctx = region.mask.getContext("2d")!;
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = region.colour;
    ctx.fillRect(0, 0, region.mask.width, region.mask.height);
    ctx.globalCompositeOperation = "source-over";
  }
  private redraw() {
    const lower = this.overlay.getContext("2d")!,
      upper = this.foreground.getContext("2d")!;
    lower.clearRect(0, 0, this.overlay.width, this.overlay.height);
    upper.clearRect(0, 0, this.foreground.width, this.foreground.height);
    let afterSelected = false;
    for (const r of this.regions) {
      if (r.id === this.selected) {
        afterSelected = true;
        continue;
      }
      if (r.enabled) (afterSelected ? upper : lower).drawImage(r.mask, 0, 0);
    }
    if (this.regions.length)
      this.mask.style.opacity = this.regions.find(
        (r) => r.id === this.selected,
      )!.enabled
        ? "0.65"
        : "0.2";
  }

  combinedMask() {
    const masks = this.regions
      .filter((r) => r.enabled)
      .map((r) => alphaOf(r.mask));
    const out = canvas(this.source.width, this.source.height);
    putAlpha(out, unionMasks(masks, out.width * out.height));
    return out;
  }
  guideOverlay() {
    const out = canvas(this.source.width, this.source.height),
      ctx = out.getContext("2d")!;
    // Later regions own overlaps, matching the visible list's priority.
    for (const r of this.regions)
      if (r.enabled) {
        ctx.drawImage(r.mask, 0, 0);
      }
    return out;
  }
  /** Cached immutable alpha snapshots are shared by metadata-only undo entries. */
  alpha(mask: HTMLCanvasElement): Uint8Array {
    let value = this.alphaCache.get(mask);
    if (!value) {
      value = alphaOf(mask);
      this.alphaCache.set(mask, value);
    }
    return value;
  }
  private capture(): State {
    return {
      selected: this.selected,
      regions: this.regions.map(({ mask, ...r }) => ({
        ...r,
        alpha: this.alpha(mask),
      })),
    };
  }
  private snapshot() {
    this.undoStack.push(this.capture());
    this.redoStack = [];
    this.trim(this.undoStack);
  }
  private trim(stack: State[]) {
    let bytes = stack.reduce(
      (n, s) => n + s.regions.reduce((m, r) => m + r.alpha.byteLength, 0),
      0,
    );
    while (stack.length > 1 && (bytes > 64 * 1024 ** 2 || stack.length > 20)) {
      bytes -= stack
        .shift()!
        .regions.reduce((m, r) => m + r.alpha.byteLength, 0);
    }
  }
  private restore(state: State) {
    this.selected = state.selected;
    this.regions = state.regions.map(({ alpha, ...r }) => {
      const mask = this.createMask();
      putAlpha(mask, alpha);
      this.alphaCache.set(mask, alpha);
      return { ...r, mask };
    });
    this.mount();
    this.changed();
  }
  undo() {
    if (this.active) return;
    const state = this.undoStack.pop();
    if (state) {
      this.redoStack.push(this.capture());
      this.trim(this.redoStack);
      this.restore(state);
    }
  }
  redo() {
    if (this.active) return;
    const state = this.redoStack.pop();
    if (state) {
      this.undoStack.push(this.capture());
      this.trim(this.undoStack);
      this.restore(state);
    }
  }
  private point(e: PointerEvent) {
    const r = this.mask.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * this.mask.width) / r.width,
      y: ((e.clientY - r.top) * this.mask.height) / r.height,
    };
  }
  private down(e: PointerEvent) {
    if (!this.loaded || e.button !== 0 || this.active) return;
    e.preventDefault();
    this.mask.setPointerCapture(e.pointerId);
    this.active = true;
    this.strokeTool = this.tool;
    this.pointerId = e.pointerId;
    this.screenPoint = { x: e.clientX, y: e.clientY };
    this.start = this.previous = this.point(e);
    if (this.strokeTool !== "pan") {
      this.snapshot();
      if (this.strokeTool === "rectangle" || this.strokeTool === "ellipse")
        this.strokeBase = this.alpha(this.mask);
      this.alphaCache.delete(this.mask);
    }
    if (this.strokeTool === "brush" || this.strokeTool === "erase")
      this.stroke(this.start, this.start);
  }
  private move(e: PointerEvent) {
    if (!this.active || e.pointerId !== this.pointerId) return;
    const p = this.point(e);
    if (this.strokeTool === "pan") {
      this.viewport.scrollLeft -= e.clientX - this.screenPoint.x;
      this.viewport.scrollTop -= e.clientY - this.screenPoint.y;
      this.screenPoint = { x: e.clientX, y: e.clientY };
    } else if (
      this.strokeTool === "rectangle" ||
      this.strokeTool === "ellipse"
    ) {
      putAlpha(this.mask, this.strokeBase!);
      const ctx = this.mask.getContext("2d")!;
      ctx.fillStyle = this.regions.find((r) => r.id === this.selected)!.colour;
      if (this.strokeTool === "rectangle")
        ctx.fillRect(
          this.start.x,
          this.start.y,
          p.x - this.start.x,
          p.y - this.start.y,
        );
      else {
        ctx.beginPath();
        ctx.ellipse(
          (p.x + this.start.x) / 2,
          (p.y + this.start.y) / 2,
          Math.abs(p.x - this.start.x) / 2,
          Math.abs(p.y - this.start.y) / 2,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    } else this.stroke(this.previous, p);
    this.previous = p;
  }
  private stroke(from: { x: number; y: number }, to: { x: number; y: number }) {
    const ctx = this.mask.getContext("2d")!;
    ctx.globalCompositeOperation =
      this.strokeTool === "erase" ? "destination-out" : "source-over";
    ctx.fillStyle = ctx.strokeStyle = this.regions.find(
      (r) => r.id === this.selected,
    )!.colour;
    ctx.lineWidth = this.brushSize;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(to.x, to.y, this.brushSize / 2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }
  private up(e: PointerEvent) {
    if (!this.active || e.pointerId !== this.pointerId) return;
    this.active = false;
    this.pointerId = undefined;
    if (this.mask.hasPointerCapture(e.pointerId))
      this.mask.releasePointerCapture(e.pointerId);
    this.strokeBase = undefined;
    if (this.strokeTool !== "pan") this.changed();
  }
  clear() {
    if (this.active) return;
    if (!this.loaded) return;
    this.snapshot();
    this.alphaCache.delete(this.mask);
    this.mask
      .getContext("2d")!
      .clearRect(0, 0, this.mask.width, this.mask.height);
    this.changed();
  }
  invert() {
    if (this.active) return;
    if (!this.loaded) return;
    this.snapshot();
    const a = new Uint8Array(this.alpha(this.mask));
    this.alphaCache.delete(this.mask);
    for (let i = 0; i < a.length; i++) a[i] = 255 - a[i];
    this.alphaCache.delete(this.mask);
    putAlpha(this.mask, a);
    this.changed();
  }
  setZoom(value: number) {
    this.zoom = value;
    this.fit();
  }
  private fit() {
    if (!this.loaded) return;
    const h = Math.max(240, this.viewport.clientHeight - 48);
    const fit = Math.min(
      1,
      Math.max(1, this.viewport.clientWidth - 48) / this.source.width,
      h / this.source.height,
    );
    this.stage.style.width = `${Math.max(1, this.source.width * fit * this.zoom)}px`;
    this.stage.style.aspectRatio = `${this.source.width}/${this.source.height}`;
  }
  private changed(pixels = true) {
    this.revision++;
    if (pixels) {
      this.pixelRevision++;
      for (const r of this.regions) this.tint(r);
      this.redraw();
    }
    this.onChange();
    this.regionListener();
  }
  async importMask(blob: Blob) {
    if (!this.loaded) throw new Error("Load a source first.");
    if (blob.size > 50_000_000) throw new Error("Mask exceeds 50 MB.");
    const b = await createImageBitmap(blob);
    if (b.width !== this.source.width || b.height !== this.source.height) {
      b.close();
      throw new Error("Mask dimensions must match the source.");
    }
    const c = canvas(b.width, b.height),
      ctx = c.getContext("2d")!;
    ctx.drawImage(b, 0, 0);
    b.close();
    const p = ctx.getImageData(0, 0, c.width, c.height).data,
      a = new Uint8Array(c.width * c.height);
    for (let i = 0; i < a.length; i++)
      a[i] = Math.round(
        ((p[i * 4] * 0.2126 + p[i * 4 + 1] * 0.7152 + p[i * 4 + 2] * 0.0722) *
          p[i * 4 + 3]) /
          255,
      );
    this.snapshot();
    this.alphaCache.delete(this.mask);
    putAlpha(this.mask, a);
    this.changed();
  }
  async exportMask() {
    const c = canvas(this.source.width, this.source.height),
      ctx = c.getContext("2d")!,
      p = ctx.createImageData(c.width, c.height),
      a = alphaOf(this.combinedMask());
    for (let i = 0; i < a.length; i++) {
      p.data[i * 4] = p.data[i * 4 + 1] = p.data[i * 4 + 2] = a[i];
      p.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(p, 0, 0);
    return canvasBlob(c);
  }
  async saveRegions(): Promise<SavedRegion[]> {
    const saved: SavedRegion[] = [];
    for (const { mask, ...r } of this.regions)
      saved.push({ ...r, blob: await canvasBlob(mask) });
    return saved;
  }
  async loadRegions(regions: SavedRegion[]) {
    if (
      !regions.length ||
      regions.length > 8 ||
      regions.length * this.source.width * this.source.height > 40_000_000
    )
      throw new Error("Invalid saved region count.");
    const loaded: Region[] = [];
    for (const { blob, ...r } of regions) {
      const b = await createImageBitmap(blob);
      if (b.width !== this.source.width || b.height !== this.source.height) {
        b.close();
        throw new Error("Saved region dimensions differ.");
      }
      const mask = this.createMask();
      mask.getContext("2d")!.drawImage(b, 0, 0);
      b.close();
      loaded.push({ ...r, mask });
    }
    this.regions = loaded;
    this.selected = loaded[0].id;
    this.undoStack = [];
    this.redoStack = [];
    this.mount();
    this.changed();
  }
}
