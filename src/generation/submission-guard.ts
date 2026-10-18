import { RunpodHttpError } from "../api/runpod";
export interface PendingSubmission {
  endpoint: string;
  id?: string;
  created: number;
}
const KEY = "qwen-pending-submission";
/** One unresolved remote submission per tab. Contains no prompt, pixels or credentials. */
export class SubmissionGuard {
  pending?: PendingSubmission;
  constructor(
    private storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  ) {
    try {
      const saved = JSON.parse(storage?.getItem(KEY) || "null");
      if (
        saved &&
        /^[A-Za-z0-9_-]+$/.test(saved.endpoint) &&
        (saved.id === undefined || /^[A-Za-z0-9_-]+$/.test(saved.id)) &&
        Number.isFinite(saved.created)
      )
        this.pending = saved;
    } catch {
      /* Storage may be unavailable; keep the in-memory guard. */
    }
  }
  private save() {
    try {
      if (this.pending)
        this.storage?.setItem(KEY, JSON.stringify(this.pending));
      else this.storage?.removeItem(KEY);
    } catch {
      /* The guard still protects this page. */
    }
  }
  begin(endpoint: string) {
    if (this.pending)
      throw new Error(
        "Resolve the previous RunPod submission before generating again.",
      );
    this.pending = { endpoint, created: Date.now() };
    this.save();
  }
  accepted(endpoint: string, id: string) {
    if (
      this.pending &&
      (this.pending.endpoint !== endpoint ||
        (this.pending.id && this.pending.id !== id))
    )
      throw new Error("Resume the unresolved RunPod job first.");
    this.pending = {
      endpoint,
      id,
      created: this.pending?.created || Date.now(),
    };
    this.save();
  }
  rejected(error: unknown) {
    // Gateway timeouts, 5xx and broken connections may have accepted the POST.
    if (
      error instanceof RunpodHttpError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 408
    )
      this.clear();
  }
  completed(endpoint: string, id: string) {
    if (this.pending?.endpoint === endpoint && this.pending.id === id)
      this.clear();
  }
  acknowledgeUnknown() {
    if (this.pending?.id)
      throw new Error("Resume or cancel the known job first.");
    this.clear();
  }
  private clear() {
    this.pending = undefined;
    this.save();
  }
}

/** Storage access itself can throw in browsers with storage disabled. */
export function createTabSubmissionGuard() {
  try {
    return new SubmissionGuard(sessionStorage);
  } catch {
    return new SubmissionGuard();
  }
}
