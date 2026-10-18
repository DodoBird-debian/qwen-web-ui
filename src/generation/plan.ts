import {
  nextSeed,
  prepare,
  randomSeed,
  MAX_SEED,
  normalizeInput,
  MAX_REQUEST_BYTES,
  type Input,
} from "../api/contract";
import { json, LosslessNumber } from "../api/json";
export interface PlanCell {
  id: string;
  label: string;
  row: number;
  column: number;
  input: Input;
}
export interface PlannedRequest {
  bytes: number;
  id: string;
  cells: PlanCell[];
  prepared: ReturnType<typeof prepare>;
}
export interface GenerationPlan {
  schemaVersion: 1;
  kind: "series" | "grid";
  baseSeed: string;
  cells: PlanCell[];
  requests: PlannedRequest[];
  rows: string[];
  columns: string[];
}
export function explicitSeed(seed: string, random = randomSeed): string {
  if (seed === "-1") return random();
  if (!/^\d+$/.test(seed) || BigInt(seed) > MAX_SEED)
    throw new Error("Invalid starting seed.");
  return seed;
}
function requestSizer(images: string[]) {
  const imageBytes = new TextEncoder().encode(json(images)).length - 2;
  return (input: Input) => {
    const bytes =
      new TextEncoder().encode(
        json({
          input: { ...input, images: [], seed: new LosslessNumber(input.seed) },
        }),
      ).length + imageBytes;
    if (bytes > MAX_REQUEST_BYTES)
      throw new Error(
        `Request is ${bytes.toLocaleString()} bytes; maximum is 10,000,000.`,
      );
    return bytes;
  };
}
function requestFor(
  cells: PlanCell[],
  index: number,
  size: (input: Input) => number,
): PlannedRequest {
  const input = { ...cells[0].input, num_images: cells.length },
    bytes = size(input);
  // Do not retain dozens of identical base64 JSON bodies. Revalidate/materialize on dispatch.
  return {
    id: `request-${index}`,
    cells,
    bytes,
    get prepared() {
      return prepare(input);
    },
  };
}
export function planSeries(
  input: Input,
  total: number,
  batch: number,
  random = randomSeed,
): GenerationPlan {
  if (!Number.isInteger(total) || total < 1 || total > 100)
    throw new Error("Choose 1–100 total images.");
  if (!Number.isInteger(batch) || batch < 1 || batch > 4)
    throw new Error("Each request must contain 1–4 images.");
  const baseSeed = explicitSeed(input.seed, random),
    size = requestSizer(input.images);
  const cells = Array.from({ length: total }, (_, i) => ({
    id: `image-${i}`,
    label: `Image ${i + 1} · seed ${nextSeed(baseSeed, i)}`,
    row: 0,
    column: i,
    input: normalizeInput({
      ...input,
      images: [...input.images],
      seed: nextSeed(baseSeed, i),
      num_images: 1,
    }),
  }));
  const requests: PlannedRequest[] = [];
  for (let i = 0; i < cells.length; i += batch)
    requests.push(requestFor(cells.slice(i, i + batch), requests.length, size));
  return {
    schemaVersion: 1,
    kind: "series",
    baseSeed,
    cells,
    requests,
    rows: [],
    columns: [],
  };
}
export type Axis = "cfg" | "steps" | "seed";
export function axisValues(axis: Axis, text: string): string[] {
  const values = text
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (!values.length || values.length > 64)
    throw new Error("Supply 1–64 comma-separated axis values.");
  for (const v of values) {
    if (axis === "seed") {
      if (!/^\d+$/.test(v) || BigInt(v) > MAX_SEED)
        throw new Error(
          "Grid seeds must be integers within the worker seed range.",
        );
    } else {
      const n = Number(v);
      if (
        !Number.isFinite(n) ||
        (axis === "cfg"
          ? n < 1 || n > 4
          : !Number.isInteger(n) || n < 1 || n > 100)
      )
        throw new Error(
          axis === "cfg"
            ? "Grid CFG must be 1–4."
            : "Grid steps must be integers from 1 to 100.",
        );
    }
  }
  return values;
}
function applyAxis(input: Input, axis: Axis, value: string) {
  if (axis === "seed") input.seed = value;
  else if (axis === "cfg") input.true_cfg_scale = Number(value);
  else input.num_inference_steps = Number(value);
}
function compatible(a: Input, b: Input) {
  const { seed: sa, num_images: na, ...restA } = a,
    { seed: sb, num_images: nb, ...restB } = b;
  return nextSeed(sa, 1) === sb && json(restA) === json(restB);
}
export function planGrid(
  input: Input,
  x: Axis,
  xText: string,
  y: Axis | "none",
  yText: string,
  negative = "",
  batch = 1,
  random = randomSeed,
): GenerationPlan {
  if (x === y) throw new Error("Choose different comparison axes.");
  const xs = axisValues(x, xText),
    ys = y === "none" ? [""] : axisValues(y, yText);
  if (xs.length * ys.length > 64)
    throw new Error("Comparison grids are limited to 64 images.");
  const baseSeed = explicitSeed(input.seed, random),
    cells: PlanCell[] = [],
    size = requestSizer(input.images);
  for (let row = 0; row < ys.length; row++)
    for (let column = 0; column < xs.length; column++) {
      const cell = {
        ...input,
        images: [...input.images],
        seed: baseSeed,
        num_images: 1,
      };
      applyAxis(cell, x, xs[column]);
      if (y !== "none") applyAxis(cell, y, ys[row]);
      if (cell.true_cfg_scale > 1) cell.negative_prompt = negative;
      else delete cell.negative_prompt;
      const label = `${x} ${xs[column]}${y === "none" ? "" : ` · ${y} ${ys[row]}`} · seed ${cell.seed}`;
      cells.push({
        id: `cell-${row}-${column}`,
        label,
        row,
        column,
        input: normalizeInput(cell),
      });
    }
  const requests: PlannedRequest[] = [];
  let group: PlanCell[] = [];
  for (const cell of cells) {
    if (
      group.length &&
      (group.length >= batch ||
        !compatible(group[group.length - 1].input, cell.input))
    ) {
      requests.push(requestFor(group, requests.length, size));
      group = [];
    }
    group.push(cell);
  }
  if (group.length) requests.push(requestFor(group, requests.length, size));
  return {
    schemaVersion: 1,
    kind: "grid",
    baseSeed,
    cells,
    requests,
    rows: ys.map((v) => (y === "none" ? "" : `${y} ${v}`)),
    columns: xs.map((v) => `${x} ${v}`),
  };
}
