const DB_NAME = "qwen-image-studio";
let connection: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("projects"))
        request.result.createObjectStore("projects", { keyPath: "id" });
      if (!request.result.objectStoreNames.contains("jobs"))
        request.result.createObjectStore("jobs", { keyPath: "id" });
      request
        .transaction!.objectStore("jobs")
        .createIndex("status-created", ["status", "created"]);
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
): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function list<T = any>(store: "projects" | "jobs"): Promise<T[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction(store).objectStore(store).getAll();
    request.onsuccess = () =>
      resolve(request.result.sort((a: any, b: any) => b.created - a.created));
    request.onerror = () => reject(request.error);
  });
}
export async function remove(
  store: "projects" | "jobs",
  id: string,
): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
