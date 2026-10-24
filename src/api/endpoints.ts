import { RunpodClient } from "./runpod";
import { validOffload, type Offload } from "../estimates/profile";

export type ModelVariant = "base" | "turbo";
export const TURBO_ENDPOINT = "kvvrwkisxhk8h7";
export const MODEL_LABELS = { base: "Qwen-Image 2.1", turbo: "Qwen-Image 2.1 Turbo" };
export interface EndpointPreset {
  endpointId: string;
  serverAuth: boolean;
  workerOffload?: Offload;
}
export interface EndpointCredentials { endpoint: string; key: string }

export function endpointId(value: string): string {
  const text = value.trim();
  const match = /^https:\/\/api\.runpod\.ai\/v2\/([A-Za-z0-9_-]+)(?:\/(?:run|runsync|health))?\/?$/.exec(text);
  const id = match?.[1] ?? text;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Enter a valid RunPod endpoint ID or URL.");
  return id;
}

export class EndpointConnections {
  private readonly credentials = new Map<string, string>();
  model: ModelVariant = "base";
  readonly presets: Record<ModelVariant, EndpointPreset> = {
    base: { endpointId: "", serverAuth: false },
    turbo: { endpointId: TURBO_ENDPOINT, serverAuth: false, workerOffload: "model" },
  };
  readonly saved: Record<ModelVariant, EndpointCredentials> = {
    base: { endpoint: "", key: "" },
    turbo: { endpoint: TURBO_ENDPOINT, key: "" },
  };
  configure(config: any) {
    for (const model of ["base", "turbo"] as const) {
      const value = config.models?.[model] ?? (model === "base" ? config : undefined);
      if (!value || typeof value.endpointId !== "string") continue;
      if (value.endpointId && !/^[A-Za-z0-9_-]+$/.test(value.endpointId)) continue;
      this.presets[model] = {
        endpointId: value.endpointId, serverAuth: value.serverAuth === true,
        ...(validOffload(value.workerOffload) ? { workerOffload: value.workerOffload } : {}),
      };
      this.saved[model] = { endpoint: value.endpointId, key: "" };
    }
  }
  serverEndpoint(endpoint: string): string {
    return Object.values(this.presets).some(p => p.serverAuth && p.endpointId === endpoint) ? endpoint : "";
  }
  get current() { return this.saved[this.model]; }
  get connected() {
    return !!this.current.endpoint && (!!this.current.key || !!this.serverEndpoint(this.current.endpoint));
  }
  connect(model: ModelVariant, endpoint: string, key: string) {
    const id = endpointId(endpoint);
    new RunpodClient(id, key, undefined, this.serverEndpoint(id));
    this.saved[model] = { endpoint: id, key: key.trim() };
    this.credentials.set(id, key.trim());
    this.model = model;
  }
  client(endpoint = this.current.endpoint): RunpodClient {
    const entry = this.current.endpoint === endpoint ? this.current
      : Object.values(this.saved).find(p => p.endpoint === endpoint);
    return new RunpodClient(endpoint, entry?.key ?? this.credentials.get(endpoint) ?? "", undefined, this.serverEndpoint(endpoint));
  }
  offload(endpoint: string) {
    if (!endpoint) return;
    return Object.values(this.presets).find(p => p.endpointId === endpoint)?.workerOffload;
  }
  persist() {
    // Keys deliberately never enter browser storage.
    localStorage.setItem("qwen-model", this.model);
    localStorage.setItem("qwen-endpoints", JSON.stringify({ base: this.saved.base.endpoint, turbo: this.saved.turbo.endpoint }));
    localStorage.setItem("qwen-endpoint", this.current.endpoint);
  }
  restore() {
    try {
      const ids = JSON.parse(localStorage.getItem("qwen-endpoints") || "null");
      for (const model of ["base", "turbo"] as const) {
        let id = ids?.[model] ?? (model === "base" ? localStorage.getItem("qwen-endpoint") : null);
        // Follow the replacement default without changing custom endpoint choices.
        if (model === "turbo" && id === "m3efd79odne8wa" && this.presets.turbo.endpointId === TURBO_ENDPOINT)
          id = TURBO_ENDPOINT;
        if (typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id))
          this.saved[model] = { endpoint: id, key: "" };
      }
      if (localStorage.getItem("qwen-model") === "turbo") this.model = "turbo";
    } catch { /* Optional preferences; never restore keys. */ }
  }
}
