import * as disk from "./indexeddb";
import { jobSummary, type JobSummary } from "./job-summary";
import type { SavedJob } from "../api/jobs";
import { MemoryRepository, type StoreName } from "../state/repository";
const session = new MemoryRepository();
let persistent = false;
const profiles = new Map<string, unknown>();
export function persistenceEnabled() {
  return persistent;
}
export async function setPersistence(enabled: boolean) {
  if (!enabled) {
    persistent = false;
    return;
  }
  if (enabled) {
    for (const [endpoint, profile] of profiles)
      disk.saveProfile(endpoint, profile);
    for (const store of ["projects", "jobs"] as const)
      for (const item of await session.list(store))
        if (!(await disk.put(store, item, true))) await session.remove(store, item.id);
    persistent = true;
  }
}
export async function put(store: StoreName, value: any) {
  if (store === "jobs" && !value.results?.length &&
      session.get<{ results?: unknown[] }>(store, value.id)?.results?.length) return;
  try {
    if (persistent && !(await disk.put(store, value))) {
      await session.remove(store, value.id);
      return;
    }
  } catch (error) {
    await session.put(store, value);
    throw error;
  }
  await session.put(store, value);
}
export async function getJob(id: string): Promise<SavedJob | undefined> {
  const cached = session.get<SavedJob>("jobs", id);
  const saved = persistent ? await disk.get<SavedJob>("jobs", id) : undefined;
  if (saved?.results?.length && !cached?.results?.length) return saved;
  if (!cached?.results?.length && !cached?.input.prompt && saved?.input.prompt) return saved;
  return cached ?? saved;
}
export async function jobFrames(id: string) {
  const cached = session.pick("jobs", id, (job: SavedJob) => job.results);
  return cached?.length ? cached : persistent ? disk.jobFrames(id) : [];
}
export async function jobSummaries(): Promise<JobSummary[]> {
  const rows = new Map<string, JobSummary>();
  for (const row of session.select("jobs", jobSummary)) rows.set(row.id, row);
  if (persistent)
    for (const row of await disk.jobSummaries()) {
      const local = rows.get(row.id);
      if (!local || row.count || !local.count) rows.set(row.id, row);
    }
  return [...rows.values()].sort((a, b) => b.created - a.created);
}
export async function list<T = any>(store: "projects"): Promise<T[]> {
  const items = new Map<string, any>();
  if (persistent)
    for (const item of await disk.list(store)) items.set(item.id, item);
  for (const item of await session.list<any>(store))
    if (!items.has(item.id) || items.get(item.id).created < item.created) items.set(item.id, item);
  return [...items.values()].sort((a, b) => b.created - a.created);
}
export async function remove(store: StoreName, id: string) {
  await session.remove(store, id);
  if (persistent) await disk.remove(store, id);
}
export async function trimHistory(limit: number) {
  const summary = new Map<
    string,
    { id: string; created: number; status?: string }
  >();
  if (persistent)
    for (const item of await disk.summaries("jobs")) summary.set(item.id, item);
  for (const item of await session.summaries("jobs"))
    summary.set(item.id, item);
  const records = [...summary.values()].sort((a, b) => b.created - a.created);
  // Successful image jobs and worker errors (which may contain raw results)
  // stay until explicit deletion. Only empty terminal failures are bounded.
  const completed = records.filter((j) =>
    [
      "COMPLETED",
      "FAILED",
      "CANCELLED",
      "TIMED_OUT",
      "WORKER_ERROR",
      "EXPIRED",
    ].includes(j.status || ""),
  );
  for (const record of completed.slice(limit))
    if (!["COMPLETED", "WORKER_ERROR"].includes(record.status || ""))
      await remove("jobs", record.id);
}
export function saveProfile(endpoint: string, profile: unknown) {
  profiles.set(endpoint, profile);
  if (persistent) disk.saveProfile(endpoint, profile);
}
export function loadProfile(endpoint: string) {
  return (
    profiles.get(endpoint) ?? (persistent ? disk.loadProfile(endpoint) : null)
  );
}
