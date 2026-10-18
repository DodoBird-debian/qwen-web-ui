/** Persistence is optional. Runtime resources and credentials never enter repositories. */
export type StoreName = "projects" | "jobs";
export interface Repository {
  put(store: StoreName, value: any): Promise<void>;
  list<T = any>(store: StoreName): Promise<T[]>;
  summaries(
    store: StoreName,
  ): Promise<{ id: string; created: number; status?: string }[]>;
  remove(store: StoreName, id: string): Promise<void>;
}
export class MemoryRepository implements Repository {
  private stores = {
    projects: new Map<string, any>(),
    jobs: new Map<string, any>(),
  };
  async put(store: StoreName, value: any) {
    this.stores[store].set(value.id, structuredClone(value));
  }
  async list<T = any>(store: StoreName): Promise<T[]> {
    return [...this.stores[store].values()]
      .sort((a, b) => b.created - a.created)
      .map((v) => structuredClone(v));
  }
  async summaries(store: StoreName) {
    return [...this.stores[store].values()].map(({ id, created, status }) => ({
      id,
      created,
      status,
    }));
  }
  async remove(store: StoreName, id: string) {
    this.stores[store].delete(id);
  }
}
