import * as disk from "./indexeddb";
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
      for (const item of await session.list(store)) await disk.put(store, item);
    persistent = true;
  }
}
export async function put(store: StoreName, value: any) {
  await session.put(store, value);
  if (persistent) await disk.put(store, value);
}
export async function list<T = any>(store: StoreName): Promise<T[]> {
  const items = new Map<string, any>();
  if (persistent)
    for (const item of await disk.list(store)) items.set(item.id, item);
  for (const item of await session.list(store)) items.set(item.id, item);
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
