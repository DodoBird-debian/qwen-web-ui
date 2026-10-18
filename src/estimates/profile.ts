export type Offload = "none" | "text_encoder" | "model" | "sequential";
export interface Profile {
  gpuGiB: number;
  safetyGiB: number;
  offload: Offload;
}
export const defaultProfile: Profile = {
  gpuGiB: 80,
  safetyGiB: 3,
  offload: "text_encoder",
};

export function validProfile(value: any): value is Profile {
  return (
    !!value &&
    Number.isFinite(value.gpuGiB) &&
    value.gpuGiB >= 1 &&
    value.gpuGiB <= 1024 &&
    Number.isInteger(value.safetyGiB) &&
    value.safetyGiB >= 0 &&
    value.safetyGiB <= 10 &&
    ["none", "text_encoder", "model", "sequential"].includes(value.offload)
  );
}

// Read old installations without changing the stored worker/request contract.
export function normalizeProfile(value: any): Profile | undefined {
  if (!value || typeof value !== "object") return;
  const safetyGiB =
    value.safetyGiB === undefined && Number.isFinite(value.headroomGiB)
      ? Math.min(10, Math.max(0, Math.ceil(value.headroomGiB)))
      : value.safetyGiB;
  const profile = { gpuGiB: value.gpuGiB, safetyGiB, offload: value.offload };
  return validProfile(profile) ? profile : undefined;
}
