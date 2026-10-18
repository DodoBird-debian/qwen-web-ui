import type { SavedJob } from "../api/jobs";
import { $, button, node } from "../lib/dom";
import { list, persistenceEnabled } from "../storage/db";

/** Browsing images never changes the job being polled or submits a request. */
export class ImageHistory {
  private records = new Map<string, SavedJob>();
  private previews = new Map<string, { blob: Blob; url: string; card: HTMLElement }>();
  private thumbnails = Promise.resolve();
  constructor(private root: HTMLElement, private view: (record: SavedJob) => void) {}

  remember(record: SavedJob) {
    if (!record.results?.length) return;
    this.records.set(record.id, record);
    this.render();
  }
  forget(id: string) {
    this.records.delete(id);
    this.render();
  }
  async restore() {
    const saved = await list<SavedJob>("jobs");
    const current = this.records;
    this.records = new Map(saved.filter((job) => job.results?.length).map((job) => [job.id, job]));
    for (const [id, job] of current) this.records.set(id, job);
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
    $("#image-history-count").textContent = `${records.reduce((sum, job) => sum + (job.results?.length || 0), 0)} images`;
    // Keep decoded previews bounded; All jobs opens every retained generation.
    const recent = records.slice(0, 12);
    for (const [id, preview] of this.previews) {
      if (!recent.some((job) => job.id === id)) {
        URL.revokeObjectURL(preview.url);
        this.previews.delete(id);
      }
    }
    const content = document.createDocumentFragment();
    for (const job of recent) {
      const blob = job.results![0].composite || job.results![0].blob;
      let preview = this.previews.get(job.id);
      if (!preview || preview.blob !== blob) {
        if (preview) URL.revokeObjectURL(preview.url);
        const card = button("", () => this.view(this.records.get(job.id)!));
        card.className = "image-history-card checkerboard";
        card.dataset.historyJob = job.runpodId;
        const image = node("img");
        image.alt = `Generation from ${new Date(job.created).toLocaleString()}`;
        image.loading = "lazy";
        image.decoding = "async";
        card.append(image, node("span", "image-history-badge"));
        preview = { blob, url: "", card };
        this.previews.set(job.id, preview);
        const entry = preview;
        // Decode one small preview at a time, including when restoring history.
        // Full-resolution blobs remain available for viewing/exporting.
        this.thumbnails = this.thumbnails.then(async () => {
          if (this.previews.get(job.id) !== entry) return;
          const bitmap = await createImageBitmap(blob);
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
      preview.card.title = `${job.input.prompt || "Generation"} · ${job.runpodId}`;
      preview.card.setAttribute("aria-label", `View ${job.results!.length} images from ${job.runpodId}`);
      preview.card.querySelector("span")!.textContent = `${job.results!.length} image${job.results!.length === 1 ? "" : "s"}`;
      content.append(preview.card);
    }
    $("#image-history-list").replaceChildren(content);
  }
}
