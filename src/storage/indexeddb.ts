import type { ResultImage, SavedJob } from "../api/jobs";
import { jobSummary, type JobSummary } from "./job-summary";

const jobStores = ["jobs", "job-summaries", "job-frames", "references"];
function read<T>(op: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    op.onsuccess = () => resolve(op.result);
    op.onerror = () => reject(op.error);
  });
}
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("Storage transaction aborted"));
    tx.onerror = () => reject(tx.error);
  });
}

async function transactionResult<T>(tx: IDBTransaction, operation: () => Promise<T>) {
  const done = committed(tx);
  const result = operation().catch(error => {
    try { tx.abort(); } catch { /* IndexedDB may have aborted already. */ }
    throw error;
  });
  const [value] = await Promise.all([result, done]);
  return value;
}

// Keep each exact worker reference once. The hash selects a bucket, and exact
// string comparison disambiguates collisions even on HTTP without Web Crypto.
async function referenceKey(store: IDBObjectStore, value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  const bucket = `${value.length}-${hash >>> 0}`;
  const entries = await read(store.index("bucket").getAll(bucket)) as { id: string; value: string }[];
  const existing = entries.find(item => item.value === value);
  if (existing) return existing.id;
  let suffix = 0;
  while (entries.some(item => item.id === bucket + "/" + suffix)) suffix++;
  const id = bucket + "/" + suffix;
  await read(store.add({ id, bucket, value }));
  return id;
}

async function forgetReferences(tx: IDBTransaction, keys: string[]) {
  const owners = tx.objectStore("jobs").index("reference-keys");
  for (const id of new Set(keys))
    if (await read(owners.count(id)) === 0) await read(tx.objectStore("references").delete(id));
}
async function storeJob(tx: IDBTransaction, job: SavedJob, oldKeys: string[]) {
  const keys: string[] = [];
  for (const image of job.input?.images || [])
    keys.push(await referenceKey(tx.objectStore("references"), image));
  const { results, ...rest } = job;
  await read(tx.objectStore("jobs").put({
    ...rest, input: job.input && { ...job.input, images: [] }, referenceKeys: keys,
  }));
  if (results?.length) tx.objectStore("job-frames").put(results, job.id);
  else tx.objectStore("job-frames").delete(job.id);
  tx.objectStore("job-summaries").put(jobSummary(job));
  await forgetReferences(tx, oldKeys.filter(key => !keys.includes(key)));
}

const DB_NAME = "qwen-image-studio";
let connection: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("projects"))
        request.result.createObjectStore("projects", { keyPath: "id" });
      if (!request.result.objectStoreNames.contains("jobs"))
        request.result.createObjectStore("jobs", { keyPath: "id" });
      const tx = request.transaction!;
      const jobs = tx.objectStore("jobs");
      if (!jobs.indexNames.contains("status-created"))
        jobs.createIndex("status-created", ["status", "created"]);
      jobs.createIndex("reference-keys", "referenceKeys", { multiEntry: true });
      request.result.createObjectStore("job-summaries", { keyPath: "id" });
      request.result.createObjectStore("job-frames");
      request.result.createObjectStore("references", { keyPath: "id" }).createIndex("bucket", "bucket");
      const legacy = jobs.openCursor();
      legacy.onsuccess = () => {
        const cursor = legacy.result;
        if (cursor) storeJob(tx, cursor.value, []).then(() => cursor.continue(), () => tx.abort());
      };
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        connection = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    connection = undefined;
    throw error;
  }));
}
export async function put(
  store: "projects" | "jobs",
  value: any,
  migrating = false,
): Promise<boolean> {
  const database = await db();
  const tx = database.transaction(store === "jobs" ? jobStores : store, "readwrite");
  const records = tx.objectStore(store);
  return transactionResult(tx, async () => {
    if (store === "projects") {
      if (migrating && (await read(records.get(value.id)))?.created >= value.created) return false;
      await read(records.put(value));
    } else {
      const prior = await read(tx.objectStore("job-summaries").get(value.id)) as JobSummary | undefined;
      if (prior?.count && !value.results?.length) return false;
      const old = prior && await read(records.get(value.id));
      await storeJob(tx, value, old?.referenceKeys || []);
    }
    return true;
  });
}
export async function get<T>(store: "projects" | "jobs", id: string): Promise<T | undefined> {
  const database = await db();
  if (store === "projects") return read(database.transaction(store).objectStore(store).get(id));
  const tx = database.transaction(jobStores);
  const record = await read(tx.objectStore("jobs").get(id));
  if (!record) return;
  const { referenceKeys, ...job } = record;
  const [frames, images] = await Promise.all([
    read(tx.objectStore("job-frames").get(id)),
    Promise.all(referenceKeys.map(async (key: string) => (await read(tx.objectStore("references").get(key))).value)),
  ]);
  if (frames) job.results = frames;
  if (job.input) job.input.images = images;
  return job as T;
}
export async function jobFrames(id: string): Promise<ResultImage[]> {
  const database = await db();
  return await read(database.transaction("job-frames").objectStore("job-frames").get(id)) || [];
}
export async function jobSummaries(): Promise<JobSummary[]> {
  const database = await db();
  return read(database.transaction("job-summaries").objectStore("job-summaries").getAll());
}
export async function list<T = any>(store: "projects"): Promise<T[]> {
  const database = await db();
  const records = await read(database.transaction(store).objectStore(store).getAll());
  return records.sort((a, b) => b.created - a.created);
}
export async function remove(store: "projects" | "jobs", id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(store === "jobs" ? jobStores : store, "readwrite");
  await transactionResult(tx, async () => {
    const records = tx.objectStore(store);
    const job = store === "jobs" && await read(records.get(id));
    await read(records.delete(id));
    if (store === "jobs") {
      tx.objectStore("job-frames").delete(id);
      tx.objectStore("job-summaries").delete(id);
      await forgetReferences(tx, job?.referenceKeys || []);
    }
  });
}
export async function summaries(
  store: "projects" | "jobs",
): Promise<{ id: string; created: number; status?: string }[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const out: { id: string; created: number; status?: string }[] = [];
    const tx = database.transaction(store);
    if (store === "jobs") {
      const request = tx
        .objectStore(store)
        .index("status-created")
        .openKeyCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const [status, created] = cursor.key as [string, number];
        out.push({ id: String(cursor.primaryKey), status, created });
        cursor.continue();
      };
    } else {
      const request = tx.objectStore(store).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const { id, created, status } = cursor.value;
        out.push({ id, created, status });
        cursor.continue();
      };
    }
    tx.oncomplete = () => resolve(out.sort((a, b) => b.created - a.created));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function trimHistory(limit: number): Promise<void> {
  const jobs = await summaries("jobs");
  // Never silently evict successful images, partial raw results, or active jobs.
  const completed = jobs.filter((job) =>
    [
      "COMPLETED",
      "FAILED",
      "CANCELLED",
      "TIMED_OUT",
      "WORKER_ERROR",
      "EXPIRED",
    ].includes(job.status || ""),
  );
  for (const job of completed.slice(limit))
    if (!["COMPLETED", "WORKER_ERROR"].includes(job.status || ""))
      await remove("jobs", job.id);
}
export function saveProfile(endpoint: string, profile: unknown): void {
  localStorage.setItem(`qwen-profile:${endpoint}`, JSON.stringify(profile));
}
export function loadProfile(endpoint: string): any {
  try {
    return JSON.parse(
      localStorage.getItem(`qwen-profile:${endpoint}`) || "null",
    );
  } catch {
    return null;
  }
}
