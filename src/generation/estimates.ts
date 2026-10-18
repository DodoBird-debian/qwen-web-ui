import type { GenerationPlan } from "./plan";
import { projectBatch, routeLabel } from "../estimates/batching";
import type { Profile } from "../estimates/profile";
export function estimatePlan(
  plan: GenerationPlan,
  sizes: { width: number; height: number }[],
  profile: Profile,
) {
  const rows = plan.requests.map((r) => {
    const input = { ...r.cells[0].input, num_images: r.cells.length },
      projection = projectBatch(input, sizes, profile, r.cells.length);
    return {
      input,
      projection,
      peak:
        projection.route === "parallel"
          ? projection.memory.safeParallelPeak
          : projection.memory.safePeak,
    };
  });
  const worst = rows.reduce((a, b) => (b.peak > a.peak ? b : a));
  return {
    worst,
    routes: [...new Set(rows.map((r) => routeLabel(r.projection.route)))],
  };
}
