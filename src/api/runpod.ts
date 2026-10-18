import { requestSignal } from "../lib/request-signal";
import { parseJson } from "./json";

export const TERMINAL = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
]);
export interface RunpodJob {
  id: string;
  status: string;
  output?: any;
  error?: unknown;
  delayTime?: number;
  executionTime?: number;
}
export class RunpodHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export class RunpodClient {
  private endpoint: string;
  private key: string;
  private fetcher: typeof fetch;
  constructor(
    endpoint: string,
    key: string,
    fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    serverEndpoint = "",
  ) {
    if (!/^[A-Za-z0-9_-]+$/.test(endpoint))
      throw new Error("Enter a valid RunPod endpoint ID.");
    if (
      /[\r\n]/.test(key) ||
      (!key.trim() && endpoint !== serverEndpoint)
    )
      throw new Error("Enter your RunPod API key.");
    this.endpoint = endpoint;
    this.key = key.trim();
    this.fetcher = fetcher;
  }
  private async request(
    operation: string,
    body?: string,
    signal?: AbortSignal,
  ): Promise<any> {
    const timeout = requestSignal(signal);
    try {
      const response = await this.fetcher(
        `/api/runpod/${this.endpoint}/${operation}`,
        {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.key ? { "X-RunPod-Api-Key": this.key } : {}),
          },
          ...(body === undefined ? {} : { body }),
          signal: timeout.signal,
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
        },
      );
      if (!response.ok)
        throw new RunpodHttpError(
          response.status,
          `RunPod HTTP ${response.status}${response.status === 401 ? ": check your API key." : response.status === 404 ? ": endpoint or job not found; results may have expired." : response.status === 429 ? ": rate limited; wait and resume polling." : "."}`,
        );
      try {
        return parseJson(await response.text());
      } catch {
        if (timeout.signal.aborted) throw timeout.signal.reason;
        throw new Error("RunPod returned an invalid JSON response.");
      }
    } finally {
      timeout.dispose();
    }
  }
  async submit(body: string): Promise<RunpodJob> {
    const result = await this.request("run", body);
    if (!result || !/^[A-Za-z0-9_-]+$/.test(result.id || ""))
      throw new Error(
        "RunPod did not return a valid job ID. Submission may have been accepted; do not automatically submit again.",
      );
    return result;
  }
  status(id: string, signal?: AbortSignal): Promise<RunpodJob> {
    return this.request(`status/${this.jobId(id)}`, undefined, signal);
  }
  cancel(id: string): Promise<RunpodJob> {
    return this.request(`cancel/${this.jobId(id)}`, "{}");
  }
  health(): Promise<any> {
    return this.request("health");
  }
  private jobId(id: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid job ID.");
    return id;
  }
}
export function workerOutput(job: RunpodJob): any {
  if (job.error)
    throw new Error(
      typeof job.error === "string" ? job.error : "RunPod job failed.",
    );
  if (job.status !== "COMPLETED")
    throw new Error(`Job ${job.status || "has no status"}.`);
  if (job.output?.error) throw new Error(String(job.output.error));
  if (!Array.isArray(job.output?.images) || !job.output.images.length)
    throw new Error("Completed job contains no images.");
  return job.output;
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
export async function poll(
  client: RunpodClient,
  id: string,
  update: (job: RunpodJob) => void | Promise<void>,
  signal: AbortSignal,
): Promise<RunpodJob> {
  let delay = 1500,
    failures = 0;
  while (!signal.aborted) {
    let job: RunpodJob;
    try {
      job = await client.status(id, signal);
      failures = 0;
    } catch (error) {
      const retryable =
        error instanceof TypeError ||
        (error instanceof DOMException && error.name === "TimeoutError") ||
        (error instanceof RunpodHttpError &&
          (error.status === 429 || error.status >= 500));
      if (signal.aborted || !retryable || ++failures > 4) throw error;
      await wait(Math.min(15000, 1500 * 2 ** (failures - 1)), signal);
      continue;
    }
    if (
      job.id !== id ||
      ![...TERMINAL, "IN_QUEUE", "IN_PROGRESS"].includes(job.status)
    )
      throw new Error(
        "RunPod returned an invalid job status. Resume the known job to check again.",
      );
    await update(job);
    if (TERMINAL.has(job.status)) return job;
    await wait(delay + Math.random() * 500, signal);
    delay = Math.min(8000, delay * 1.25);
  }
  throw signal.reason;
}
