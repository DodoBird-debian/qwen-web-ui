import type { SavedJob } from "../api/jobs";
import { TERMINAL } from "../api/runpod";
import { button, node } from "../lib/dom";

export function finishedJob(record: SavedJob): boolean {
  return TERMINAL.has(record.status) || ["WORKER_ERROR", "EXPIRED"].includes(record.status);
}

export class GenerationActivity {
  private heading = node("strong");
  private elapsed = node("span", "generation-elapsed");
  private message = node("p");
  private stop: HTMLButtonElement;
  private resume: HTMLButtonElement;
  private started = 0;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private root: HTMLElement,
    cancel: () => void | Promise<void>,
    resume: () => void | Promise<void>,
  ) {
    const summary = node("div", "generation-summary");
    const spinner = node("span", "generation-spinner");
    spinner.setAttribute("aria-hidden", "true");
    this.heading.id = "generation-state";
    this.heading.setAttribute("role", "status");
    this.elapsed.setAttribute("aria-live", "off");
    summary.append(spinner, this.heading, this.elapsed);
    this.stop = button("Stop generation", cancel, "button generation-stop");
    this.stop.id = "stop-generation";
    this.resume = button("Check server status", resume);
    this.resume.id = "check-generation";
    const actions = node("div", "button-row");
    actions.append(this.resume, this.stop);
    root.append(summary, actions, this.message);
  }

  update(submitting: boolean, record: SavedJob | undefined, polling: boolean, pending: boolean) {
    const terminal = record && finishedJob(record);
    const active = submitting || (!!record && !terminal) || pending;
    this.root.hidden = !active && !record;
    this.root.classList.toggle("active", active);
    this.root.dataset.state = submitting ? "SUBMITTING" : record?.status || "UNKNOWN";
    this.stop.hidden = !record || !!terminal || submitting;
    this.stop.disabled = !!record?.cancelRequested && !record.cancelError;
    this.stop.textContent = record?.cancelError ? "Retry cancellation" : record?.cancelRequested ? "Stopping…" : "Stop generation";
    this.resume.hidden = submitting || !record || !!terminal || polling;
    this.started = submitting ? Date.now() : record?.created || Date.now();
    const labels: Record<string, string> = {
      IN_QUEUE: "Queued · waiting for a worker",
      IN_PROGRESS: "Generating image on RunPod",
      COMPLETED: "Generation completed",
      CANCELLED: "RunPod confirmed cancellation",
      FAILED: "Generation failed",
      TIMED_OUT: "RunPod reports a timeout",
      WORKER_ERROR: "Worker returned an error",
      EXPIRED: "Job is no longer available on RunPod",
    };
    let heading = record ? labels[record.status] || record.status : "Submission unconfirmed";
    let message = record?.error || (record ? `Job ${record.runpodId}` : "Check RunPod before submitting another request.");
    if (submitting) {
      heading = "Submitting generation…";
      message = "Sending one request. Waiting for its job ID.";
    } else if (!terminal && record?.cancelRequested) {
      heading = "Stopping · waiting for RunPod confirmation";
      message = record.cancelError
        ? `Cancellation is unconfirmed: ${record.cancelError}. The job may still be running. Retry cancellation or check server status.`
        : "Cancellation requested. Generation stays blocked until a server status check confirms the outcome.";
    } else if (!terminal && record) {
      message = polling
        ? `Job ${record.runpodId} · checking server status. Step progress is unavailable.`
        : `Job ${record.runpodId} · status checks are paused. The remote job may still be running.`;
    } else if (record?.status === "COMPLETED" && record.cancelRequested) {
      message = "The job completed before cancellation took effect. Its result is available.";
    }
    this.heading.textContent = heading;
    this.message.textContent = message;
    if (this.timer) clearInterval(this.timer);
    const tick = () => { this.elapsed.textContent = `${Math.max(0, Math.floor((Date.now() - this.started) / 1000))}s elapsed`; };
    tick();
    if (active) this.timer = setInterval(tick, 1000);
  }
}
