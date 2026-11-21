import type { SavedJob } from "../api/jobs";
import { $, button, node, toast } from "../lib/dom";
import { getJob, jobFrames, jobSummaries, persistenceEnabled } from "../storage/db";

import { jobSummary, type JobSummary } from "../storage/job-summary";

/** Browsing images never changes the job being polled or submits a request. */
export class ImageHistory {
  private records = new Map<string, JobSummary>();
  private previews = new Map<string, { job: JobSummary; url: string; card: HTMLElement }>();
  private thumbnails = Promise.resolve();
  constructor(private root: HTMLElement, private view: (record: SavedJob) => void) {
    const toggle = root.querySelector<HTMLButtonElement>("#history-toggle")!;
    toggle.addEventListener("click", () => {
      const content = root.querySelector<HTMLElement>("#image-history-content")!;
      content.hidden = !content.hidden;
      toggle.setAttribute("aria-expanded", String(!content.hidden));
      toggle.textContent = `Image history ${content.hidden ? "▸" : "▾"}`;
    });
  }

  get hasImages() { return !!this.records.size; }

  private recent() {
    return [...this.records.values()].sort((a, b) => b.created - a.created).slice(0, 12);
  }

  async sources() {
    const sources: { blob: Blob; name: string }[] = [];
    for (const job of this.recent()) {
      for (const image of await jobFrames(job.id)) {
        sources.push({ blob: image.composite || image.blob, name: `Result ${image.seed}` });
        if (sources.length === 12) return sources;
      }
    }
    return sources;
  }

  remember(record: SavedJob) {
    if (!record.results?.length) return;
    const row = jobSummary(record), prior = this.records.get(row.id);
    if (prior && prior.count === row.count && prior.status === row.status) return;
    this.records.set(record.id, row);
    this.render();
  }
  forget(id: string) {
    this.records.delete(id);
    this.render();
  }
  async restore() {
    const saved = await jobSummaries();
    this.records = new Map(saved.filter(job => job.count > 0).map(job => [job.id, job]));
    this.render();
  }
  note() {
    $("#image-history-note").textContent = persistenceEnabled()
      ? "Saved in this browser. Images stay until you delete them."
      : "Images stay when switching tools. Enable browser storage to keep them after reload.";
  }
  private render() {
    const records = [...this.records.values()].sort((a, b) => b.created - a.created);
    this.root.hidden = !records.length;
    this.note();
    $("#image-history-count").textContent = `${records.reduce((sum, job) => sum + job.count, 0)} images`;
    // Keep decoded previews bounded; All jobs opens every retained generation.
    const recent = this.recent();
    for (const [id, preview] of this.previews) {
      if (!recent.some((job) => job.id === id)) {
        URL.revokeObjectURL(preview.url);
        this.previews.delete(id);
      }
    }
    const content = document.createDocumentFragment();
    for (const job of recent) {
      let preview = this.previews.get(job.id);
      if (!preview || preview.job !== job) {
        if (preview) URL.revokeObjectURL(preview.url);
        const card = button("", async () => {
          const record = await getJob(job.id);
          if (!record?.results?.length) return toast("Saved images are unavailable.", true);
          this.view(record);
        });
        card.className = "image-history-card checkerboard";
        card.dataset.historyJob = job.runpodId;
        const image = node("img");
        image.alt = `Generation from ${new Date(job.created).toLocaleString()}`;
        image.loading = "lazy";
        image.decoding = "async";
        card.append(image, node("span", "image-history-badge"));
        preview = { job, url: "", card };
        this.previews.set(job.id, preview);
        const entry = preview;
        // Decode one small preview at a time, including when restoring history.
        // Full-resolution blobs remain available for viewing/exporting.
        this.thumbnails = this.thumbnails.then(async () => {
          if (this.previews.get(job.id) !== entry) return;
          const [frame] = await jobFrames(job.id);
          if (!frame || this.previews.get(job.id) !== entry) return;
          const bitmap = await createImageBitmap(frame.composite || frame.blob);
          const canvas = node("canvas"); canvas.width = canvas.height = 96;
          const scale = Math.max(96 / bitmap.width, 96 / bitmap.height);
          try { canvas.getContext("2d")!.drawImage(bitmap,
            (96 - bitmap.width * scale) / 2, (96 - bitmap.height * scale) / 2,
            bitmap.width * scale, bitmap.height * scale); }
          finally { bitmap.close(); }
          const thumbnail = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.75));
          canvas.width = canvas.height = 1;
          if (!thumbnail || this.previews.get(job.id) !== entry) return;
          entry.url = URL.createObjectURL(thumbnail);
          image.src = entry.url;
        }).catch(() => { image.alt = "Preview unavailable; open the saved generation."; });
      }
      preview.card.title = `${job.title} · ${job.runpodId}`;
      preview.card.setAttribute("aria-label", `View ${job.count} images from ${job.runpodId}`);
      preview.card.querySelector("span")!.textContent = `${job.count} image${job.count === 1 ? "" : "s"}`;
      content.append(preview.card);
    }
    $("#image-history-list").replaceChildren(content);
  }
}
