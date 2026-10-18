import { inspectImage } from "../references/images";
import { RunpodHttpError } from "./runpod";
import { SubmissionGuard } from "../generation/submission-guard";
import type { Input } from "./contract";
import { RunpodClient, poll, workerOutput } from "./runpod";
import { exactInteger } from "./json";
import { type InpaintSnapshot } from "../editor/inpaint";

export interface ResultImage {
  id?: string;
  blob: Blob;
  composite?: Blob;
  seed: string;
  width: number;
  height: number;
  mime: string;
}
export interface SavedJob {
  id: string;
  runpodId: string;
  endpoint: string;
  created: number;
  status: string;
  input: Input;
  results?: ResultImage[];
  outputMeta?: any;
  error?: string;
  inpaint?: InpaintSnapshot;
  delayTime?: number;
  executionTime?: number;
}
export interface JobHooks {
  update: (job: SavedJob) => void;
  storageError: (message: string) => void;
}
export class JobManager {
  private abort?: AbortController;
  private hooks: JobHooks;
  private limit: number;
  current?: SavedJob;
  polling = false;
  constructor(
    hooks: JobHooks,
    limit = 12,
    private repository?: {
      save: (record: SavedJob, limit: number) => Promise<void>;
    },
    private process?: (snapshot: InpaintSnapshot, blob: Blob) => Promise<Blob>,
    readonly guard = new SubmissionGuard(),
  ) {
    this.hooks = hooks;
    this.limit = limit;
  }
  setHistoryLimit(limit: number) {
    this.limit = limit;
  }
  private async persist(record: SavedJob) {
    try {
      await this.repository?.save(record, this.limit);
    } catch {
      this.hooks.storageError(
        "Browser history could not be saved (storage full or unavailable). Download your result.",
      );
    }
  }
  async submit(
    client: RunpodClient,
    endpoint: string,
    prepared: { body: string; input: Input },
    inpaint?: InpaintSnapshot,
  ): Promise<SavedJob> {
    this.guard.begin(endpoint);
    this.current = undefined;
    let response;
    try {
      response = await client.submit(prepared.body);
    } catch (error) {
      this.guard.rejected(error);
      throw error;
    }
    this.guard.accepted(endpoint, response.id);
    const record: SavedJob = {
      id: `${endpoint}:${response.id}`,
      runpodId: response.id,
      endpoint,
      status: response.status || "IN_QUEUE",
      created: Date.now(),
      input: prepared.input,
      inpaint,
    };
    this.current = record;
    // Publish the accepted ID before any slow or failing persistence work.
    this.hooks.update(record);
    await this.persist(record);
    await this.follow(client, record);
    return record;
  }
  async follow(client: RunpodClient, record: SavedJob): Promise<void> {
    if (this.polling) throw new Error("A job is already being followed.");
    if (record.status === "COMPLETED" && record.results?.length) {
      this.current = record;
      this.hooks.update(record);
      return;
    }
    this.guard.accepted(record.endpoint, record.runpodId);
    const abort = new AbortController();
    this.abort = abort;
    this.current = record;
    this.polling = true;
    this.hooks.update(record);
    try {
      const result = await poll(
        client,
        record.runpodId,
        async (response) => {
          record.status = response.status;
          record.delayTime = response.delayTime;
          record.executionTime = response.executionTime;
          this.hooks.update(record);
        },
        abort.signal,
      );
      if (result.status === "COMPLETED") {
        try {
          const output = workerOutput(result);
          record.results = [];
          if (
            output.images.length !== record.input.num_images &&
            record.input.prompt
          )
            throw new Error("Worker returned an unexpected image count.");
          if (output.images.length > 4)
            throw new Error("Worker returned too many images.");
          for (const image of output.images) {
            if (
              !Number.isInteger(image.width) ||
              !Number.isInteger(image.height) ||
              image.width < 1 ||
              image.height < 1 ||
              image.width > 4096 ||
              image.height > 4096 ||
              image.width * image.height > 4_500_000 ||
              typeof image.image_base64 !== "string" ||
              image.image_base64.length > 10_000_000
            )
              throw new Error("Result image exceeds the worker limits.");
            if (
              !["image/png", "image/jpeg", "image/webp"].includes(
                image.mime_type,
              ) ||
              typeof image.image_base64 !== "string"
            )
              throw new Error("Unexpected worker image data.");
            const binary = atob(image.image_base64),
              bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++)
              bytes[i] = binary.charCodeAt(i);
            const header = inspectImage(bytes.buffer);
            if (
              header.width !== image.width ||
              header.height !== image.height ||
              header.mime !== image.mime_type
            )
              throw new Error(
                "Result image header does not match its metadata.",
              );
            const blob = new Blob([bytes], { type: image.mime_type });
            const decoded = await createImageBitmap(blob);
            if (
              decoded.width !== image.width ||
              decoded.height !== image.height
            ) {
              decoded.close();
              throw new Error(
                "Result image dimensions do not match its metadata.",
              );
            }
            decoded.close();
            const entry: ResultImage = {
              id: `${record.id}:${record.results.length}`,
              blob,
              seed: exactInteger(image.seed, "returned seed"),
              width: image.width,
              height: image.height,
              mime: image.mime_type,
            };
            // Preserve raw results even if local compositing fails.
            record.results.push(entry);
            if (record.inpaint && this.process) {
              try {
                entry.composite = await this.process(record.inpaint, blob);
              } catch (error) {
                record.error = `Local composite failed: ${error instanceof Error ? error.message : String(error)}. Raw output is available.`;
              }
            }
          }
          record.outputMeta = Object.fromEntries(
            Object.entries(output).filter(([name]) => name !== "images"),
          );
        } catch (error) {
          record.status = "WORKER_ERROR";
          record.error = error instanceof Error ? error.message : String(error);
        }
      } else
        record.error =
          typeof result.error === "string"
            ? result.error
            : `Job ${result.status.toLowerCase()}.`;
      this.guard.completed(record.endpoint, record.runpodId);
      await this.persist(record);
      this.hooks.update(record);
    } catch (error) {
      if (error instanceof RunpodHttpError && error.status === 404) {
        record.status = "EXPIRED";
        record.error =
          "RunPod no longer has this job. Its results may have expired.";
        this.guard.completed(record.endpoint, record.runpodId);
        await this.persist(record);
      }
      throw error;
    } finally {
      if (this.abort === abort) {
        this.polling = false;
        this.hooks.update(record);
      }
    }
  }
  pause() {
    this.abort?.abort(new DOMException("Polling paused", "AbortError"));
  }
}
