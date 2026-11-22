import {
  planSeries,
  planGrid,
  planPromptVariants,
  type Axis,
  type GenerationPlan,
} from "../generation/plan";
import type { Input } from "../api/contract";
import { button, node } from "../lib/dom";
export class RunControls {
  private turbo = false;
  private baseGrid?: string[];
  constructor(
    private root: HTMLElement,
    change: () => void,
  ) {
    root.innerHTML = `<section class="batch-planner" aria-label="Images and request planning"><h3>Images & requests</h3><div id="image-presets" class="image-presets" aria-label="Image count shortcuts"></div><details class="run-options" id="run-options"><summary>Run options</summary><label class="field">Run type<select id="run-kind"><option value="single">One batch · up to 4 images</option><option value="series">More images · automatic batches</option><option value="grid">Parameter comparison grid</option><option value="variants">Prompt variants</option></select></label><div id="single-controls"><label class="field">Images / request<select id="image-count"><option>1</option><option>2</option><option>3</option><option>4</option></select><small>Maximum 4 per API request</small></label><label class="switch-field"><span>Separate output jobs<small>Send one image at a time</small></span><input id="separate-jobs" type="checkbox" role="switch"></label></div><div id="series-controls" hidden><label class="field">Total images<input id="series-total" type="number" min="1" max="100" value="20"></label><label class="field">Images per request<select id="series-batch"><option value="1">1 · separate requests</option><option value="2">Up to 2</option><option value="3">Up to 3</option><option value="4" selected>Up to 4 · recommended</option></select></label></div><div id="grid-controls" hidden><label class="field">Columns<select id="grid-x"><option value="steps">Steps</option><option value="cfg">CFG</option><option value="seed">Seed</option></select></label><label class="field">Column values (comma separated)<input id="grid-x-values" value="20,40,60"></label><label class="field">Rows<select id="grid-y"><option value="none">None · one-axis strip</option><option value="cfg" selected>CFG</option><option value="steps">Steps</option><option value="seed">Seed</option></select></label><label class="field">Row values (comma separated)<input id="grid-y-values" value="1,2,3"></label><label class="field">Grouping<select id="grid-batch"><option value="1">1 · controlled comparison</option><option value="4">Up to 4 · only consecutive seeds with identical settings</option></select></label><p class="subtle">Same seed across non-seed axes. CFG 1 omits the negative prompt; CFG above 1 activates it. Fixed seeds do not guarantee identical output across batch routes.</p></div><div id="variant-controls" hidden><label class="field">Prompt variants<textarea id="prompt-variants" rows="5" placeholder="Warm light | A vase in warm light&#10;Cool light | A vase in cool light"></textarea><small>One name and instruction per line, separated by |. Each uses the same seed and references.</small></label></div></details><p id="run-summary" class="notice"></p><div id="batch-plan" class="batch-plan" aria-label="Planned requests"></div><p id="batch-details" class="subtle"></p></section>`;
    for (const count of [1, 4, 10, 20]) {
      const preset = button(`${count}`, () => {
        root.querySelector<HTMLSelectElement>("#run-kind")!.value = count > 4 ? "series" : "single";
        root.querySelector<HTMLInputElement>("#series-total")!.value = String(count);
        root.querySelector<HTMLSelectElement>("#series-batch")!.value = "4";
        this.setImageCount(Math.min(4, count));
        change();
      }, "count-preset");
      preset.dataset.count = String(count);
      preset.setAttribute("aria-label", `Create ${count} images`);
      preset.title = count > 4 ? `${count} images, sequential requests of up to 4` : `${count} images in one request`;
      root.querySelector("#image-presets")!.append(preset);
    }
    root.addEventListener("input", () => {
      this.sync();
      change();
    });
    this.sync();
  }
  private value(id: string) {
    return this.root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      `#${id}`,
    )!.value;
  }
  normal() {
    this.root.querySelector<HTMLSelectElement>("#run-kind")!.value = "single";
    this.root.querySelector<HTMLInputElement>("#separate-jobs")!.checked = false;
    this.sync();
  }
  get kind() {
    return this.value("run-kind");
  }
  setTurbo(enabled: boolean) {
    if (enabled === this.turbo) return;
    const ids = ["grid-x", "grid-y", "grid-x-values", "grid-y-values"];
    if (enabled) this.baseGrid = ids.map(id => this.value(id));
    this.turbo = enabled;
    this.root.querySelectorAll<HTMLOptionElement>('option[value="steps"]').forEach(option => option.disabled = enabled);
    if (enabled) {
      if (this.value("grid-x") === "steps") {
        this.root.querySelector<HTMLSelectElement>("#grid-x")!.value = "seed";
        this.root.querySelector<HTMLInputElement>("#grid-x-values")!.value = "100,101,102";
        if (this.value("grid-y") === "seed") this.root.querySelector<HTMLSelectElement>("#grid-y")!.value = "cfg";
      }
      if (this.value("grid-y") === "steps") this.root.querySelector<HTMLSelectElement>("#grid-y")!.value = "none";
    } else if (this.baseGrid) {
      ids.forEach((id, index) => this.root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!.value = this.baseGrid![index]);
    }
    this.sync();
  }
  get imageCount() {
    return Number(this.value("image-count"));
  }
  setImageCount(count: number) {
    if (!Number.isInteger(count) || count < 1 || count > 4) return;
    this.root.querySelector<HTMLSelectElement>("#image-count")!.value = String(count);
    this.sync();
  }
  separateJobs() {
    return this.root.querySelector<HTMLInputElement>("#separate-jobs")!.checked;
  }
  private sync() {
    this.root.querySelector<HTMLElement>("#single-controls")!.hidden = this.kind !== "single";
    this.root.querySelector<HTMLSelectElement>("#image-count")!.disabled = this.kind !== "single";
    this.root.querySelector<HTMLInputElement>("#separate-jobs")!.disabled = this.kind !== "single";
    const count = this.kind === "single" ? this.imageCount
      : this.kind === "series" ? Number(this.value("series-total")) : undefined;
    this.root.querySelectorAll<HTMLElement>("[data-count]").forEach(item =>
      item.setAttribute("aria-pressed", String(Number(item.dataset.count) === count)));
    this.root.querySelector<HTMLElement>("#series-controls")!.hidden =
      this.kind !== "series";
    this.root.querySelector<HTMLElement>("#grid-controls")!.hidden =
      this.kind !== "grid";
    this.root.querySelector<HTMLElement>("#variant-controls")!.hidden = this.kind !== "variants";
  }
  plan(input: Input, negative: string, compileVariant: (value: string) => string): GenerationPlan | undefined {
    if (this.turbo) {
      input = { ...input, num_inference_steps: 8 };
      if (this.kind === "grid" && [this.value("grid-x"), this.value("grid-y")].includes("steps"))
        throw new Error("Turbo uses fixed 8 steps; compare CFG or seeds instead.");
    }
    if (this.kind === "single") return;
    if (this.kind === "variants") return planPromptVariants(input, this.value("prompt-variants"), compileVariant);
    if (this.kind === "series")
      return planSeries(
        input,
        Number(this.value("series-total")),
        Number(this.value("series-batch")),
      );
    return planGrid(
      input,
      this.value("grid-x") as Axis,
      this.value("grid-x-values"),
      this.value("grid-y") as Axis | "none",
      this.value("grid-y-values"),
      negative,
      Number(this.value("grid-batch")),
    );
  }
  describe(input: Input, negative: string, separate: boolean, compileVariant: (value: string) => string) {
    const p = this.plan(
        { ...input, seed: input.seed === "-1" ? "0" : input.seed },
        negative, compileVariant,
      ),
      summary = this.root.querySelector<HTMLElement>("#run-summary")!;
    const shown = p || planSeries({ ...input, seed: input.seed === "-1" ? "0" : input.seed }, input.num_images, separate ? 1 : 4);
    const counts = shown.requests.map((request) => request.cells.length);
    summary.textContent = `${shown.cells.length} images · ${shown.requests.length} request${shown.requests.length === 1 ? "" : "s"} · ${counts.join(" + ")}. Each request waits for the previous result. Maximum 4 images/request. ${input.seed === "-1" ? "One random starting seed on Start." : `Starting seed ${shown.baseSeed}.`} Keep this tab open.`;
    document.querySelector("#composer-run-summary")!.textContent =
      `${shown.cells.length} image${shown.cells.length === 1 ? "" : "s"} · ${counts.length} request${counts.length === 1 ? "" : "s"}${counts.length > 1 ? ` (${counts.join(" + ")})` : ""}`;
    const requests = this.root.querySelector<HTMLElement>("#batch-plan")!;
    const detail = this.root.querySelector<HTMLElement>("#batch-details")!;
    requests.replaceChildren();
    const describe = (index: number) => {
      requests.querySelectorAll("button").forEach((item, i) => item.setAttribute("aria-pressed", String(i === index)));
      const request = shown.requests[index];
      detail.textContent = `Request ${index + 1}: ${request.cells.length} image${request.cells.length === 1 ? "" : "s"} · ${input.seed === "-1" ? "seeds resolved on Start" : `seeds ${request.cells.map(cell => cell.input.seed).join(", ")}`} · ${request.bytes.toLocaleString()} bytes. Preview only.`
        + (this.kind === "variants" ? `\n${request.cells[0].input.prompt}` : "");
    };
    shown.requests.forEach((request, index) => {
      const chip = button(`${index + 1} · ${request.cells.length} image${request.cells.length === 1 ? "" : "s"}`, () => describe(index), "planned-request");
      chip.setAttribute("aria-label", `Preview request ${index + 1}: ${request.cells.length} images`);
      requests.append(chip);
    });
    describe(0);
    return p;
  }
}
