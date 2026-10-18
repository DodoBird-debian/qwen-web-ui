import { type Profile, GiB } from "../estimates/memory";
import {
  projectBatches,
  routeLabel,
  routeReason,
  type GenerationRoute,
} from "../estimates/batching";
import { $, gibLabel, node } from "../lib/dom";
import type { Input } from "../api/contract";

export function bindEstimatorControls(change: () => void) {
  $("#batch-preview-count").addEventListener("change", change);
}

function memoryBar(
  label: string,
  raw: number,
  safety: number,
  capacity: number,
  kind: "sequential" | "parallel",
) {
  const root = node("div", `vram-comparison ${kind}`);
  root.dataset.kind = kind;
  root.dataset.rawBytes = String(raw);
  root.dataset.safetyBytes = String(safety);
  root.dataset.totalBytes = String(raw + safety);
  const heading = node("div", "vram-bar-heading");
  heading.append(
    node("span", "", label),
    node("strong", "mono", gibLabel(raw + safety)),
  );
  const track = node("div", "vram-track"),
    base = node("span", "vram-base"),
    buffer = node("span", "vram-safety");
  track.setAttribute("role", "img");
  track.setAttribute(
    "aria-label",
    `${label}: ${gibLabel(raw)} plus ${gibLabel(safety)} safety, out of ${gibLabel(capacity)} GPU VRAM`,
  );
  const basePercent = Math.min(100, (raw / capacity) * 100);
  base.style.width = `${basePercent}%`;
  buffer.style.width = `${Math.max(0, Math.min(100 - basePercent, (safety / capacity) * 100))}%`;
  track.append(base, buffer);
  root.append(heading, track);
  if (raw + safety > capacity)
    root.append(
      node(
        "small",
        "vram-overflow",
        `${gibLabel(raw + safety - capacity)} over capacity`,
      ),
    );
  return root;
}

export function renderEstimates(
  input: Input,
  sizes: { width: number; height: number }[],
  profile: Profile,
  separateJobs = false,
) {
  const batches = projectBatches(input, sizes, profile);
  const previewCount = Number(
    $<HTMLSelectElement>("#batch-preview-count").value,
  );
  const preview = batches[previewCount - 1],
    current = batches[(separateJobs ? 1 : input.num_images) - 1];
  const memory = preview.memory,
    container = $("#memory-estimate");
  const actualRoute: GenerationRoute =
    separateJobs && current.route !== "over-capacity"
      ? "separate-jobs"
      : current.route;
  const actualPeak =
    actualRoute === "parallel"
      ? current.memory.safeParallelPeak
      : current.memory.safePeak;
  container.replaceChildren();
  container.append(
    node("p", "vram-caption", "Current request · buffered peak"),
  );
  const total = node("div", "memory-total");
  total.append(
    node("strong", "", (actualPeak / GiB).toFixed(1)),
    node("span", "", `GiB / ${profile.gpuGiB}`),
  );
  container.append(total);
  const actual = node(
    "div",
    "route-label actual-route",
    `Current request: ${routeLabel(actualRoute)}`,
  );
  actual.dataset.route = actualRoute;
  container.append(
    actual,
    node("p", "subtle vram-route-reason", routeReason(actualRoute)),
  );
  container.append(
    node(
      "div",
      "vram-preview-title",
      `${previewCount}× preview · same ${profile.gpuGiB} GiB GPU`,
    ),
  );
  container.append(
    memoryBar(
      "Sequential · 1× at a time",
      memory.peak,
      memory.safetyBytes,
      profile.gpuGiB * GiB,
      "sequential",
    ),
  );
  container.append(
    memoryBar(
      `Parallel · ${previewCount}× physical batch`,
      memory.parallelPeak,
      memory.safetyBytes,
      profile.gpuGiB * GiB,
      "parallel",
    ),
  );
  const legend = node("div", "vram-legend");
  legend.append(
    node("span", "legend-sequential", "Sequential"),
    node("span", "legend-parallel", "Parallel"),
    node("span", "legend-safety", `+${profile.safetyGiB} GiB safety`),
  );
  container.append(legend);
  const predicted = node(
    "div",
    "route-label preview-route",
    `${previewCount}× preview: ${routeLabel(preview.route)}`,
  );
  predicted.dataset.route = preview.route;
  predicted.title = routeReason(preview.route);
  container.append(predicted);

  const details = node("details", "memory-details");
  details.append(node("summary", "", "Compare 1–4 images & phase peaks"));
  const comparison = node("table", "batch-comparison");
  comparison.innerHTML =
    "<caption>Buffered physical batch estimates</caption><thead><tr><th>Batch</th><th>Peak</th><th>Estimated route</th></tr></thead>";
  const rows = node("tbody");
  for (const batch of batches) {
    const row = node("tr");
    if (batch.count === previewCount) row.className = "selected";
    row.append(
      node("th", "", `${batch.count}×`),
      node("td", "mono", gibLabel(batch.memory.safeParallelPeak)),
      node("td", "", routeLabel(batch.route)),
    );
    rows.append(row);
  }
  comparison.append(rows);
  details.append(comparison);
  const phases = node("table", "batch-comparison phase-comparison");
  phases.innerHTML = `<caption>Model + request tensors + flat safety</caption><thead><tr><th>Phase</th><th>Sequential</th><th>${previewCount}× parallel</th></tr></thead>`;
  const phaseRows = node("tbody");
  memory.sequential.forEach((phase, index) => {
    const row = node("tr");
    row.append(
      node("th", "", phase.name),
      node("td", "mono", gibLabel(phase.bytes + memory.safetyBytes)),
      node(
        "td",
        "mono",
        gibLabel(memory.parallel[index].bytes + memory.safetyBytes),
      ),
    );
    phaseRows.append(row);
  });
  phases.append(phaseRows);
  details.append(phases);
  details.append(
    node(
      "p",
      "subtle",
      `KV ${gibLabel(memory.kv)} per image / ${gibLabel(memory.parallelKv)} for ${previewCount}×. Reference tokens ${memory.imageTokens.toLocaleString()} · target ${memory.target.toLocaleString()}. ${profile.offload} offload. The flat safety addition is not multiplied by batch size. Shared weights mean total VRAM does not simply scale by four.`,
    ),
  );
  container.append(details);
  $("#output-budget").textContent = `Output · ${current.output.message}`;
}
