import type { SavedJob, ResultImage } from "../api/jobs";
import type { GenerationPlan, PlannedRequest } from "./plan";
export type RunState =
  | "ready"
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "submission-uncertain"
  | "completed";
export interface CellResult {
  status:
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "unknown"
    | "cancelled";
  job?: SavedJob;
  result?: ResultImage;
  error?: string;
}
export class SeriesRunner {
  state: RunState = "ready";
  readonly cells = new Map<string, CellResult>();
  readonly jobs: SavedJob[] = [];
  currentJob?: SavedJob;
  error = "";
  started = 0;
  private terminalFailure = false;
  private stopRequested = false;
  private cancelRequested = false;
  private cancelSent = "";
  private currentRequest?: PlannedRequest;
  constructor(
    readonly plan: GenerationPlan,
    private execute: (request: PlannedRequest) => Promise<SavedJob>,
    private changed: () => void,
    private cancelJob?: (job: SavedJob) => Promise<unknown>,
  ) {
    for (const c of plan.cells) this.cells.set(c.id, { status: "pending" });
  }
  get active() {
    return this.state === "running" || this.state === "stopping";
  }
  get completed() {
    return [...this.cells.values()].filter((c) => c.status === "completed")
      .length;
  }
  known(job: SavedJob) {
    if (!this.active || !this.currentRequest) return;
    this.currentJob = job;
    const fresh = !this.jobs.some((j) => j.id === job.id);
    if (fresh) this.jobs.push(job);
    for (const c of this.currentRequest.cells)
      this.cells.set(c.id, { ...this.cells.get(c.id)!, job });
    this.changed();
    if (this.cancelRequested && this.cancelSent !== job.id) {
      this.cancelSent = job.id;
      void this.cancelJob?.(job).catch((e) => {
        this.error = `Cancellation failed: ${e.message}. Stop after current remains active.`;
        this.changed();
      });
    }
  }
  /** Reconcile a manually resumed known job; never dispatch remaining requests. */
  reconcile(job: SavedJob) {
    if (
      this.active ||
      ![
        "COMPLETED",
        "FAILED",
        "CANCELLED",
        "TIMED_OUT",
        "WORKER_ERROR",
      ].includes(job.status)
    )
      return;
    if (this.terminalFailure) return;
    let matched = false;
    for (const cell of this.plan.cells) {
      const saved = this.cells.get(cell.id)!;
      if (saved.job?.id !== job.id) continue;
      matched = true;
      const result = job.results?.find((r) => r.seed === cell.input.seed);
      this.cells.set(cell.id, {
        status:
          job.status === "COMPLETED" && result
            ? "completed"
            : job.status === "CANCELLED"
              ? "cancelled"
              : "failed",
        job,
        result,
        error: job.error,
      });
    }
    if (matched) {
      this.state =
        this.completed === this.plan.cells.length ? "completed" : "stopped";
      this.error = job.error || "";
      this.changed();
    }
  }
  stop() {
    if (!this.active) return;
    this.stopRequested = true;
    this.state = "stopping";
    this.changed();
  }
  cancel() {
    this.stop();
    this.cancelRequested = true;
    if (this.currentJob) this.known(this.currentJob);
  }
  async start() {
    if (this.state !== "ready")
      throw new Error(
        "This run has already started. Create a new plan to generate again.",
      );
    this.state = "running";
    this.started = Date.now();
    this.changed();
    for (const request of this.plan.requests) {
      if (this.stopRequested) break;
      this.currentRequest = request;
      this.currentJob = undefined;
      for (const c of request.cells)
        this.cells.set(c.id, { status: "running" });
      this.changed();
      try {
        const job = await this.execute(request);
        this.known(job);
        if (
          job.status !== "COMPLETED" ||
          job.results?.length !== request.cells.length
        )
          throw new Error(
            job.error ||
              `Job ${job.status}; expected ${request.cells.length} images.`,
          );
        request.cells.forEach((cell, i) => {
          const result = job.results![i];
          if (result.seed !== cell.input.seed)
            throw new Error(
              `Worker returned seed ${result.seed}; expected ${cell.input.seed}.`,
            );
          this.cells.set(cell.id, { status: "completed", job, result });
        });
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
        const known = this.currentJob as SavedJob | undefined;
        this.state = known ? "failed" : "submission-uncertain";
        this.terminalFailure =
          !!known &&
          [
            "COMPLETED",
            "WORKER_ERROR",
            "FAILED",
            "CANCELLED",
            "TIMED_OUT",
          ].includes(known.status);
        if (!known)
          this.error +=
            " Submission may have reached RunPod. Check the endpoint before starting another run.";
        for (const c of request.cells) {
          const previous = this.cells.get(c.id)!;
          if (previous.status !== "completed")
            this.cells.set(c.id, {
              ...previous,
              result: known?.results?.find((r) => r.seed === c.input.seed),
              status: known
                ? known.status === "CANCELLED"
                  ? "cancelled"
                  : "failed"
                : "unknown",
              error: this.error,
            });
        }
        this.changed();
        return;
      }
      this.changed();
    }
    this.state =
      this.completed === this.plan.cells.length ? "completed" : "stopped";
    this.changed();
  }
}
