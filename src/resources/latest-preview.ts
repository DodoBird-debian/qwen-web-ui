/** Debounce and serialize native encodes, publishing only the latest settings. */
export class LatestPreview<T> {
  private version = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private queued = false;
  private closed = false;
  private controller?: AbortController;
  constructor(private actions: {
    encode: (signal: AbortSignal) => Promise<T>;
    pending: () => void;
    ready: (value: T) => void;
    discard: (value: T) => void;
    error: (error: unknown) => void;
  }) {}
  invalidate() {
    if (this.closed) return;
    this.version++;
    this.controller?.abort();
    this.queued = false;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.run(); }, 300);
  }
  async run() {
    clearTimeout(this.timer);
    if (this.closed) return;
    if (this.running) { this.queued = true; return; }
    this.running = true;
    this.queued = false;
    const token = this.version;
    const controller = this.controller = new AbortController();
    this.actions.pending();
    try {
      const value = await this.actions.encode(controller.signal);
      if (this.closed || token !== this.version) this.actions.discard(value);
      else this.actions.ready(value);
    } catch (error) {
      if (!this.closed && token === this.version) this.actions.error(error);
    } finally {
      this.running = false;
      if (this.queued && !this.closed) void this.run();
    }
  }
  close() {
    this.closed = true;
    this.version++;
    this.queued = false;
    clearTimeout(this.timer);
    this.controller?.abort();
  }
}
