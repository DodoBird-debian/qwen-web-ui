import { ASPECTS, DEFAULTS, type Input } from "../api/contract";
import { $ } from "../lib/dom";

export class SettingsPanel {
  private root: HTMLElement;
  private change: () => void;
  private importedCfg?: number;
  constructor(root: HTMLElement, change: () => void) {
    this.root = root;
    this.change = change;
    root.innerHTML = `
    <label class="field">Canvas size<select id="aspect"><option value="custom">Custom dimensions</option>${Object.entries(
      ASPECTS,
    )
      .map(
        ([ratio, size]) =>
          `<option value="${ratio}">${ratio} · ${size[0]} × ${size[1]}</option>`,
      )
      .join("")}</select></label>
    <div class="field-row"><label class="field">Width<input id="width" type="number" value="1024" min="256" max="4096" step="32"></label><span class="times">×</span><label class="field">Height<input id="height" type="number" value="1024" min="256" max="4096" step="32"></label></div>
    <div class="field-row"><label class="field">Steps<input id="steps" type="number" value="8" min="1" max="100"></label><label class="field">Images / request<select id="image-count"><option>1</option><option>2</option><option>3</option><option>4</option></select><small>Maximum 4 per API request</small></label></div>
    <label class="field">Seed<span class="input-action"><input id="seed" type="text" inputmode="numeric" value="-1" autocomplete="off"><button id="random-seed" type="button" title="Use random seed" aria-label="Use random seed">⤨</button></span><small>-1 chooses a random seed</small></label>
    <div class="field-row"><label class="field">Format<select id="format"><option value="png">PNG</option><option value="webp">WebP</option><option value="jpeg">JPEG</option></select></label><label class="field">Quality<input id="quality" type="number" min="1" max="100" value="95"></label></div>
    <label class="switch-field"><span>Transparent background<small>Prompt the model for RGBA output</small></span><input id="transparent" type="checkbox" role="switch"></label>
    <details class="advanced" open><summary>Model controls <span>⌄</span></summary>
      <label class="field cfg-control"><span>True CFG scale <output id="cfg-output">1.0</output></span><input id="cfg" type="range" min="1" max="4" step="0.1" value="1"><small>1–4 · above 1 adds a second transformer pass</small><small id="cfg-import-note" hidden></small></label>
      <label class="field">Reference processing<select id="ref-resolution"><option value="512">512 · lower memory</option><option value="1024" selected>1024 · default</option><option value="2048">2048 · more detail</option></select><small>Independent of output dimensions</small></label>
      <label class="switch-field"><span>Reference KV cache<small>Faster inference, more VRAM</small></span><input id="kv-cache" type="checkbox" role="switch" checked></label>
      <label class="switch-field"><span>Separate output jobs<small>Normal generation only; series/grid use their own grouping</small></span><input id="separate-jobs" type="checkbox" role="switch"></label>
    </details>`;
    root.addEventListener("input", (event) => {
      if ((event.target as HTMLElement).id === "cfg")
        this.importedCfg = undefined;
      this.sync();
      this.change();
    });
    $("#aspect", root).addEventListener("change", () => {
      const size = ASPECTS[this.value("aspect")];
      if (size) {
        this.set("width", size[0]);
        this.set("height", size[1]);
      }
      this.change();
    });
    for (const dimension of ["width", "height"])
      $(`#${dimension}`, root).addEventListener("input", () =>
        this.set("aspect", "custom"),
      );
    $("#random-seed", root).addEventListener("click", () => {
      this.set("seed", "-1");
      this.change();
    });
    this.sync();
  }
  private value(id: string): string {
    return $<HTMLInputElement>(`#${id}`, this.root).value;
  }
  private checked(id: string): boolean {
    return $<HTMLInputElement>(`#${id}`, this.root).checked;
  }
  private set(id: string, value: string | number) {
    $<HTMLInputElement>(`#${id}`, this.root).value = String(value);
  }
  read(): Omit<Input, "prompt" | "images" | "negative_prompt"> {
    return {
      width: Number(this.value("width")),
      height: Number(this.value("height")),
      num_inference_steps: Number(this.value("steps")),
      num_images: Number(this.value("image-count")),
      seed: this.value("seed"),
      output_format: this.value("format") as Input["output_format"],
      quality: Number(this.value("quality")),
      transparent: this.checked("transparent"),
      true_cfg_scale: this.cfgValue(),
      output_resolution: Number(this.value("ref-resolution")),
      use_kv_cache: this.checked("kv-cache"),
    };
  }
  write(input: Input) {
    const fields: Record<string, unknown> = {
      width: input.width,
      height: input.height,
      steps: input.num_inference_steps,
      "image-count": input.num_images,
      seed: input.seed,
      format: input.output_format,
      quality: input.quality,
      "ref-resolution": input.output_resolution,
    };
    for (const [id, value] of Object.entries(fields))
      this.set(id, String(value));
    this.set("cfg", input.true_cfg_scale);
    this.importedCfg =
      Number(this.value("cfg")) === input.true_cfg_scale
        ? undefined
        : input.true_cfg_scale;
    $<HTMLInputElement>("#transparent", this.root).checked = input.transparent;
    $<HTMLInputElement>("#kv-cache", this.root).checked = input.use_kv_cache;
    this.set("aspect", "custom");
    this.sync();
  }
  reset() {
    this.write(DEFAULTS);
    this.change();
  }
  setImageCount(count: number) {
    if (!Number.isInteger(count) || count < 1 || count > 4) return;
    this.set("image-count", count);
    this.change();
  }
  separateJobs(): boolean {
    return this.checked("separate-jobs");
  }
  private cfgValue(): number {
    return this.importedCfg ?? Number(this.value("cfg"));
  }
  private sync() {
    $("#cfg-output", this.root).textContent =
      this.importedCfg === undefined
        ? this.cfgValue().toFixed(1)
        : String(this.importedCfg);
    const imported = $("#cfg-import-note", this.root);
    imported.hidden = this.importedCfg === undefined;
    imported.textContent =
      this.importedCfg === undefined
        ? ""
        : `Imported CFG ${this.importedCfg} is preserved. Move the 1–4 slider to replace it.`;
    $<HTMLInputElement>("#quality", this.root).disabled =
      this.value("format") === "png" ||
      (this.value("format") === "webp" && this.checked("transparent"));
    $("#negative-field").hidden = this.cfgValue() <= 1;
  }
}
