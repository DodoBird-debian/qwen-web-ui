import type { Input } from "../api/contract";
import { estimate, type Profile } from "./memory";
import { outputBudget } from "./output";

export type GenerationRoute =
  | "over-capacity"
  | "single"
  | "parallel"
  | "sequential-memory"
  | "separate-jobs";
export function projectBatch(
  input: Input,
  sizes: { width: number; height: number }[],
  profile: Profile,
  count: number,
) {
  if (!Number.isInteger(count) || count < 1 || count > 4)
    throw new Error("Batch size must be 1–4.");
  const request = { ...input, num_images: count };
  const memory = estimate(request, sizes, profile),
    output = outputBudget(request);
  const route: GenerationRoute =
    memory.memoryRoute === "likely rejected"
      ? "over-capacity"
      : count === 1
        ? "single"
        : memory.memoryRoute !== "parallel candidate"
          ? "sequential-memory"
          : "parallel";
  return { count, memory, output, route };
}
export function projectBatches(
  input: Input,
  sizes: { width: number; height: number }[],
  profile: Profile,
) {
  return [1, 2, 3, 4].map((count) =>
    projectBatch(input, sizes, profile, count),
  );
}
export function routeLabel(route: GenerationRoute): string {
  return {
    "over-capacity": "Over configured VRAM",
    single: "Sequential · 1 image",
    parallel: "Parallel generation",
    "sequential-memory": "Sequential · VRAM budget",
    "separate-jobs": "Sequential · separate jobs",
  }[route];
}
export function routeReason(route: GenerationRoute): string {
  return {
    "over-capacity":
      "Even one image exceeds the configured capacity with your safety buffer.",
    single: "This request contains one image.",
    parallel:
      "A physical batch fits the configured VRAM budget with your buffer.",
    "sequential-memory":
      "One image fits, but the physical batch exceeds the configured VRAM budget with your buffer.",
    "separate-jobs":
      "The UI submits one image per job because Separate output jobs is enabled.",
  }[route];
}
