import type { Input } from "../api/contract";
import { estimate, type Profile } from "./memory";
import { outputBudget } from "./output";

export type GenerationRoute =
  | "over-capacity"
  | "single"
  | "parallel"
  | "sequential-memory"
  | "sequential-output"
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
          : !output.guaranteedFit
            ? "sequential-output"
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
    "sequential-output": "Sequential · output budget",
    "separate-jobs": "Sequential · separate jobs",
  }[route];
}
export function routeReason(route: GenerationRoute): string {
  return {
    "over-capacity":
      "Even one image exceeds the configured capacity with your safety buffer.",
    single: "This request contains one image.",
    parallel:
      "Both the buffered VRAM estimate and PNG transport bound admit a physical batch.",
    "sequential-memory":
      "One image fits, but the physical batch exceeds the configured VRAM budget with your buffer.",
    "sequential-output":
      "VRAM admits a physical batch; the frozen worker's inline-output bound routes it sequentially.",
    "separate-jobs":
      "The UI submits one image per job because Separate output jobs is enabled.",
  }[route];
}
