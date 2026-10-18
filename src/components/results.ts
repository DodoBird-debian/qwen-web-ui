import { button, download, node, toast } from "../lib/dom";
import { json } from "../api/json";
import { nextSeed } from "../api/contract";
import type { ResultImage, SavedJob } from "../api/jobs";
import type { InspectItem } from "../inspection/viewer";
export interface ResultActions {
  reference: (image: ResultImage) => Promise<void>;
  inpaint: (image: ResultImage) => Promise<void>;
  reuse: (job: SavedJob, seed?: string) => Promise<void>;
}
export interface CollectionCell {
  id: string;
  label: string;
  status: string;
  job?: SavedJob;
  result?: ResultImage;
  error?: string;
}
export class ResultsPanel {
  private cards = new Map<
    string,
    { key: unknown[]; card: HTMLElement; urls: string[] }
  >();
  private inspect: InspectItem[] = [];
  private syncCount = () => {};
  private selected = new Set<string>();
  private collectionId = "";
  private exportVariant = "raw";
  constructor(private root: HTMLElement) {}
  show(job: SavedJob, actions: ResultActions) {
    let cells: CollectionCell[] = (job.results || []).map((result, i) => ({
      id: result.id || `${job.id}:${i}`, label: `Image ${i + 1}`, status: "completed", job, result,
    }));
    for (let i = cells.length; i < job.input.num_images; i++)
      cells.push({ id: `${job.id}:omitted-${i}`, label: `Not returned ${i + 1}`,
                   status: "omitted", job, error: "This image was not returned. It was not automatically retried." });
    if (job.input.prompt && /^\d+$/.test(job.input.seed) &&
        Number.isInteger(job.input.num_images) && job.input.num_images >= 1 && job.input.num_images <= 4) {
      const seeds = Array.from({ length: job.input.num_images }, (_, i) => nextSeed(job.input.seed, i));
      const received = new Map(cells.filter((cell) => cell.result).map((cell) => [cell.result!.seed, cell]));
      if ([...received.keys()].every((seed) => seeds.includes(seed)))
        cells = seeds.map((seed, i) => received.has(seed)
          ? { ...received.get(seed)!, label: `Image ${i + 1}` }
          : { id: `${job.id}:omitted-${i}`, label: `Image ${i + 1} · Seed ${seed}`,
              status: "omitted", job, error: "This image was not returned. It was not automatically retried." });
    }
    this.showCollection(
      job.id,
      cells,
      actions,
    );
  }
  showCollection(
    id: string,
    cells: CollectionCell[],
    actions: ResultActions,
    columns?: number,
  ) {
    for (const [key, cached] of this.cards) {
      if (id !== this.collectionId || !cells.some((c) => c.id === key)) {
        cached.urls.forEach((u) => URL.revokeObjectURL(u));
        this.cards.delete(key);
      }
    }
    const content = document.createDocumentFragment();
    if (id !== this.collectionId) {
      this.collectionId = id;
      this.selected = new Set(cells.map((c) => c.id));
    }
    this.root.classList.toggle("comparison-grid", !!columns);
    this.root.classList.toggle("single-result", cells.length === 1);
    this.root.style.setProperty("--grid-columns", String(columns || 2));
    const available = cells.filter((c) => c.result && c.job);
    this.inspect = available.map((c) => ({
      result: c.result!,
      job: c.job!,
      label: c.label,
    }));
    const toolbar = node("div", "collection-toolbar");
    toolbar.append(
      node(
        "strong",
        "",
        `${available.length} / ${cells.length} images received`,
      ),
    );
    const count = node("span", "subtle");
    const syncCount = () =>
      (count.textContent = `${available.filter((c) => this.selected.has(c.id)).length} selected`);
    this.syncCount = syncCount;
    syncCount();
    const variant = node("select");
    variant.setAttribute("aria-label", "Batch export variant");
    for (const v of ["raw", "composite"]) {
      const o = node(
        "option",
        "",
        v === "raw" ? "Raw exports" : "Composite exports (raw if none)",
      );
      o.value = v;
      variant.append(o);
    }
    variant.value = this.exportVariant;
    variant.onchange = () => {
      this.exportVariant = variant.value;
    };
    toolbar.append(
      count,
      variant,
      button(
        "Select all",
        () => {
          cells.forEach((c) => this.selected.add(c.id));
          this.root
            .querySelectorAll<HTMLInputElement>(".result-select")
            .forEach((el) => (el.checked = true));
          syncCount();
        },
        "text-button",
      ),
      button(
        "Select none",
        () => {
          this.selected.clear();
          this.root
            .querySelectorAll<HTMLInputElement>(".result-select")
            .forEach((el) => (el.checked = false));
          syncCount();
        },
        "text-button",
      ),
    );
    const picked = () => available.filter((c) => this.selected.has(c.id));
    const actualVariant = (c: CollectionCell) =>
      variant.value === "composite" && c.result?.composite
        ? "composite"
        : "raw";
    const exportBlob = (c: CollectionCell) =>
      variant.value === "composite"
        ? c.result!.composite || c.result!.blob
        : c.result!.blob;
    toolbar.append(
      button("Download selected ZIP", async () => {
        const items = picked();
        if (!items.length) throw new Error("Select at least one result.");
        const { createArchive } = await import("../export/archive");
        const archive = await createArchive(
          items.map((c) => {
            const b = exportBlob(c),
              { images: _, ...input } = c.job!.input;
            return {
              name: `qwen-${c.result!.seed}-${actualVariant(c)}.${b.type.split("/")[1]}`,
              blob: b,
              metadata: {
                seed: c.result!.seed,
                jobId: c.job!.runpodId,
                input,
                label: c.label,
                variant: actualVariant(c),
              },
            };
          }),
        );
        download(archive, "qwen-results.zip");
      }),
      button("Contact sheet", async () => {
        const { contactSheet } = await import("../export/contact-sheet");
        const all = cells.filter((c) => this.selected.has(c.id));
        if (!all.length) throw new Error("Select at least one cell.");
        download(
          await contactSheet(
            all.map((c) => ({
              blob: c.result ? exportBlob(c) : undefined,
              label: `${c.label}${c.result ? "" : ` · ${c.status}`}`,
            })),
            Math.min(10, columns || Math.ceil(Math.sqrt(all.length))),
          ),
          "qwen-contact-sheet.png",
        );
      }),
    );
    content.append(toolbar);
    for (const warning of new Set(cells.map((cell) => cell.job?.warning).filter(Boolean))) {
      const notice = node("p", "notice delivery-notice", warning);
      notice.setAttribute("role", "status");
      content.append(notice);
    }
    for (const c of cells) {
      const key = [
        c.status,
        c.label,
        c.error,
        c.job?.id,
        c.job?.error,
        c.result?.blob,
        c.result?.composite,
      ];
      const old = this.cards.get(c.id);
      if (old && key.every((v, i) => v === old.key[i])) {
        old.card.querySelector<HTMLInputElement>(".result-select")!.checked =
          this.selected.has(c.id);
        content.append(old.card);
        continue;
      }
      old?.urls.forEach((u) => URL.revokeObjectURL(u));
      const urls: string[] = [];
      const card = node("article", "result-card");
      this.cards.set(c.id, { key, card, urls });
      card.dataset.cellId = c.id;
      const header = node("div", "result-heading");
      const select = node("input", "result-select");
      select.type = "checkbox";
      select.checked = this.selected.has(c.id);
      select.setAttribute("aria-label", `Select ${c.label}`);
      select.onchange = () => {
        if (select.checked) this.selected.add(c.id);
        else this.selected.delete(c.id);
        this.syncCount();
      };
      header.append(
        node(
          "strong",
          "",
          c.result?.composite
            ? "Local composite"
            : c.result
              ? "Generated image"
              : c.status,
        ),
        select,
      );
      card.append(header, node("p", "result-label", c.label));
      if (!c.result || !c.job) {
        card.append(node("p", "notice", c.error || c.status));
        if (c.job)
          card.append(
            button(
              "Load request settings",
              () => actions.reuse(c.job!),
              "text-button",
            ),
          );
        content.append(card);
        continue;
      }
      const r = c.result,
        job = c.job,
        viewerIndex = available.findIndex((a) => a.id === c.id);
      const open = async (v: "raw" | "composite") => {
        const { openViewer } = await import("../inspection/viewer");
        openViewer(this.inspect, viewerIndex, v);
      };
      const pair = node("div", "result-pair");
      const preview = (blob: Blob, variant: "raw" | "composite") => {
        const figure = node("figure", `result-variant ${variant}-variant`);
        figure.append(
          node(
            "figcaption",
            "",
            variant === "raw" ? "Raw worker output" : "Local composite",
          ),
        );
        const wrap = node("div", "result-preview checkerboard");
        wrap.dataset.variant = variant;
        const img = node("img");
        const url = URL.createObjectURL(blob);
        urls.push(url);
        img.src = url;
        img.alt = `${variant === "raw" ? "Raw worker output" : "Local composite"} · ${c.label}`;
        img.loading = "lazy";
        wrap.append(img);
        wrap.tabIndex = 0;
        wrap.setAttribute("role", "button");
        wrap.setAttribute("aria-label", `Inspect ${variant} · ${c.label}`);
        wrap.onclick = () => {
          void open(variant);
        };
        wrap.onkeydown = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void open(variant);
          }
        };
        const controls = node("div", "button-row");
        controls.append(
          button(`Inspect ${variant}`, () => open(variant), "text-button"),
          button(
            variant === "raw" ? "Download raw ↓" : "Composite ↓",
            () =>
              download(
                blob,
                `qwen-${r.seed}-${variant}.${blob.type.split("/")[1]}`,
              ),
            "text-button",
          ),
          button(
            `Export ${variant}`,
            async () => {
              const { openExport } = await import("../export/dialog");
              openExport(blob, `qwen-${r.seed}-${variant}`);
            },
            "text-button",
          ),
        );
        figure.append(wrap, controls);
        return figure;
      };
      // Both are always visible; the raw image remains available even after a local failure.
      if (r.composite) pair.append(preview(r.composite, "composite"));
      pair.append(preview(r.blob, "raw"));
      card.append(pair);
      card.append(
        node("p", "result-seed mono", `Seed ${r.seed}`),
        node(
          "p",
          "result-label",
          `${r.width} × ${r.height} raw · ${(r.blob.size / 1_000_000).toFixed(2)} MB`,
        ),
      );
      const row = node("div", "result-actions");
      row.append(
        button("Use reference", () => actions.reference(r), "text-button"),
        button("Inpaint", () => actions.inpaint(r), "text-button"),
        button("Reuse seed", () => actions.reuse(job, r.seed), "text-button"),
        button(
          "Download metadata",
          () => {
            const { images: _, ...input } = job.input;
            download(
              new Blob(
                [
                  json(
                    {
                      jobId: job.runpodId,
                      input,
                      seed: r.seed,
                      label: c.label,
                      output: job.outputMeta,
                    },
                    true,
                  ),
                ],
                { type: "application/json" },
              ),
              `qwen-${r.seed}-metadata.json`,
            );
          },
          "text-button",
        ),
      );
      card.append(row);
      if (job.error) card.append(node("p", "notice", job.error));
      content.append(card);
    }
    this.root.replaceChildren(content);
  }
}
