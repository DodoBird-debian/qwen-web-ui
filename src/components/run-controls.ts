import {
  planSeries,
  planGrid,
  type Axis,
  type GenerationPlan,
} from "../generation/plan";
import type { Input } from "../api/contract";
import { button, node } from "../lib/dom";
export class RunControls {
  constructor(
    private root: HTMLElement,
    change: () => void,
    pickCount: (count: number) => void = () => {},
  ) {
    root.innerHTML = `<section class="batch-planner" aria-label="Images and request planning"><h3>Images & requests</h3><div id="image-presets" class="image-presets" aria-label="Image count shortcuts"></div><label class="field">Run type<select id="run-kind"><option value="single">One batch · up to 4 images</option><option value="series">More images · automatic batches</option><option value="grid">Parameter comparison grid</option></select></label><div id="series-controls" hidden><label class="field">Total images<input id="series-total" type="number" min="1" max="100" value="20"></label><label class="field">Images per request<select id="series-batch"><option value="1">1 · separate requests</option><option value="2">Up to 2</option><option value="3">Up to 3</option><option value="4" selected>Up to 4 · recommended</option></select></label></div><div id="grid-controls" hidden><label class="field">Columns<select id="grid-x"><option value="steps">Steps</option><option value="cfg">CFG</option><option value="seed">Seed</option></select></label><label class="field">Column values (comma separated)<input id="grid-x-values" value="20,40,60"></label><label class="field">Rows<select id="grid-y"><option value="none">None · one-axis strip</option><option value="cfg" selected>CFG</option><option value="steps">Steps</option><option value="seed">Seed</option></select></label><label class="field">Row values (comma separated)<input id="grid-y-values" value="1,2,3"></label><label class="field">Grouping<select id="grid-batch"><option value="1">1 · controlled comparison</option><option value="4">Up to 4 · only consecutive seeds with identical settings</option></select></label><p class="subtle">Same seed across non-seed axes. CFG 1 omits the negative prompt; CFG above 1 activates it. Fixed seeds do not guarantee identical output across batch routes.</p></div><p id="run-summary" class="notice"></p><div id="batch-plan" class="batch-plan" aria-label="Planned requests"></div><p id="batch-details" class="subtle"></p></section>`;
    for (const count of [1, 4, 10, 20]) {
      const preset = button(`${count}`, () => {
        root.querySelector<HTMLSelectElement>("#run-kind")!.value = count > 4 ? "series" : "single";
        root.querySelector<HTMLInputElement>("#series-total")!.value = String(count);
        root.querySelector<HTMLSelectElement>("#series-batch")!.value = "4";
        this.sync();
        pickCount(Math.min(4, count));
        change();
      }, "count-preset");
      preset.setAttribute("aria-label", `Create ${count} images`);
      preset.title = count > 4 ? `${count} images, sequential requests of up to 4` : `${count} images in one request`;
      root.querySelector("#image-presets")!.append(preset);
    }
    root.addEventListener("input", () => {
      this.sync();
      change();
    });
    root.addEventListener("change", () => {
      this.sync();
      change();
    });
    this.sync();
  }
  private value(id: string) {
    return this.root.querySelector<HTMLInputElement | HTMLSelectElement>(
      `#${id}`,
    )!.value;
  }
  normal() {
    this.root.querySelector<HTMLSelectElement>("#run-kind")!.value = "single";
    this.sync();
  }
  get kind() {
    return this.value("run-kind");
  }
  private sync() {
    this.root.querySelector<HTMLElement>("#series-controls")!.hidden =
      this.kind !== "series";
    this.root.querySelector<HTMLElement>("#grid-controls")!.hidden =
      this.kind !== "grid";
  }
  plan(input: Input, negative: string): GenerationPlan | undefined {
    if (this.kind === "single") return;
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
  describe(input: Input, negative: string, separate = false) {
    const p = this.plan(
        { ...input, seed: input.seed === "-1" ? "0" : input.seed },
        negative,
      ),
      summary = this.root.querySelector<HTMLElement>("#run-summary")!;
    const shown = p || planSeries({ ...input, seed: input.seed === "-1" ? "0" : input.seed }, input.num_images, separate ? 1 : 4);
    const counts = shown.requests.map((request) => request.cells.length);
    summary.textContent = `${shown.cells.length} images · ${shown.requests.length} request${shown.requests.length === 1 ? "" : "s"} · ${counts.join(" + ")}. Each request waits for the previous result. Maximum 4 images/request. ${input.seed === "-1" ? "One random starting seed on Start." : `Starting seed ${shown.baseSeed}.`} Keep this tab open.`;
    const requests = this.root.querySelector<HTMLElement>("#batch-plan")!;
    const detail = this.root.querySelector<HTMLElement>("#batch-details")!;
    requests.replaceChildren();
    const describe = (index: number) => {
      requests.querySelectorAll("button").forEach((item, i) => item.setAttribute("aria-pressed", String(i === index)));
      const request = shown.requests[index];
      detail.textContent = `Request ${index + 1}: ${request.cells.length} image${request.cells.length === 1 ? "" : "s"} · ${input.seed === "-1" ? "seeds resolved on Start" : `seeds ${request.cells.map(cell => cell.input.seed).join(", ")}`} · ${request.bytes.toLocaleString()} bytes. Preview only.`;
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
