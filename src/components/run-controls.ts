import {
  planSeries,
  planGrid,
  type Axis,
  type GenerationPlan,
} from "../generation/plan";
import type { Input } from "../api/contract";
import { node } from "../lib/dom";
export class RunControls {
  constructor(
    private root: HTMLElement,
    change: () => void,
  ) {
    root.innerHTML = `<details class="advanced" open><summary>Repeated runs & comparisons</summary><label class="field">Run type<select id="run-kind"><option value="single">Normal generation</option><option value="series">Consecutive-seed series</option><option value="grid">Parameter comparison grid</option></select></label><div id="series-controls" hidden><label class="field">Total images<input id="series-total" type="number" min="1" max="100" value="20"></label><label class="field">Images per request<select id="series-batch"><option value="1">1 · separate requests</option><option value="4" selected>4 · worker chooses parallel/sequential</option></select></label></div><div id="grid-controls" hidden><label class="field">Columns<select id="grid-x"><option value="steps">Steps</option><option value="cfg">CFG</option><option value="seed">Seed</option></select></label><label class="field">Column values (comma separated)<input id="grid-x-values" value="20,40,60"></label><label class="field">Rows<select id="grid-y"><option value="none">None · one-axis strip</option><option value="cfg" selected>CFG</option><option value="steps">Steps</option><option value="seed">Seed</option></select></label><label class="field">Row values (comma separated)<input id="grid-y-values" value="1,2,3"></label><label class="field">Grouping<select id="grid-batch"><option value="1">1 · controlled comparison</option><option value="4">Up to 4 · only consecutive seeds with identical settings</option></select></label><p class="subtle">Same seed across non-seed axes. CFG 1 omits the negative prompt; CFG above 1 activates it. Fixed seeds do not guarantee identical output across batch routes.</p></div><p id="run-summary" class="notice"></p></details>`;
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
  describe(input: Input, negative: string) {
    const p = this.plan(
        { ...input, seed: input.seed === "-1" ? "0" : input.seed },
        negative,
      ),
      summary = this.root.querySelector<HTMLElement>("#run-summary")!;
    summary.textContent = p
      ? `${p.cells.length} images · ${p.requests.length} back-to-back requests · ${input.seed === "-1" ? "one random starting seed, resolved on Start" : `starting seed ${p.baseSeed}`} · ${Math.max(...p.requests.map((r) => r.bytes)).toLocaleString()} bytes maximum/request. Browser must remain open.`
      : "Single request; use Images above. Separate output jobs still supported.";
    return p;
  }
}
