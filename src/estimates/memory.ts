import { effectivePrompt, type Input, SOURCE_COMMIT } from "../api/contract";
import type { Profile } from "./profile";
export { defaultProfile, type Profile, type Offload } from "./profile";

export const GiB = 1024 ** 3;
export const WEIGHTS = {
  transformer: 14230249472,
  text_encoder: 17534247392,
  vae: 675480808,
};
export const ESTIMATOR_SOURCE = SOURCE_COMMIT;
// Python round uses ties to even; Math.round does not.
export function roundEven(value: number): number {
  const floor = Math.floor(value),
    fraction = value - floor;
  return fraction === 0.5 ? floor + (floor % 2) : Math.round(value);
}
export function referenceTokens(
  width: number,
  height: number,
  resolution: number,
): number {
  const ratio = width / height,
    target = Math.sqrt(resolution * resolution * ratio);
  return roundEven(target / 32) * 2 * (roundEven(target / ratio / 32) * 2);
}
export function textBound(text: string, references: number): number {
  return new TextEncoder().encode(text).length + 128 + 16 * references;
}
export function estimate(
  input: Input,
  sizes: { width: number; height: number }[],
  profile: Profile,
) {
  const text = textBound(effectivePrompt(input), sizes.length);
  const negativeText =
    input.true_cfg_scale > 1
      ? textBound(input.negative_prompt || "", sizes.length)
      : 0;
  const imageTokens = sizes.reduce(
    (sum, size) =>
      sum + referenceTokens(size.width, size.height, input.output_resolution),
    0,
  );
  const prefix = text + imageTokens,
    negativePrefix = negativeText ? negativeText + imageTokens : 0;
  const target = (input.width / 16) * (input.height / 16),
    branches = input.true_cfg_scale > 1 ? 2 : 1;
  const kv = input.use_kv_cache ? (prefix + negativePrefix) * 524288 : 0;
  const activations = (prefix + negativePrefix + target * branches) * 131072;
  const seq = kv + activations + 3 * GiB;
  const par =
    (kv + activations) * input.num_images +
    3 * GiB +
    ((input.num_images - 1) * GiB) / 2;
  const conditioning =
    Math.max(prefix, negativePrefix) * 64 * 4096 * 2 + 3 * GiB;
  const pixels = input.width * input.height * 16;
  const tensors = { conditioning, denoising: seq, decoding: seq + pixels };
  const batchTensors = {
    conditioning,
    denoising: par,
    decoding: par + pixels * input.num_images,
  };
  const all = WEIGHTS.transformer + WEIGHTS.text_encoder + WEIGHTS.vae;
  const placement =
    profile.offload === "none"
      ? [all, all, all]
      : profile.offload === "text_encoder"
        ? [
            all,
            WEIGHTS.transformer + WEIGHTS.vae,
            WEIGHTS.transformer + WEIGHTS.vae,
          ]
        : [
            WEIGHTS.text_encoder + WEIGHTS.vae,
            WEIGHTS.transformer + WEIGHTS.vae,
            WEIGHTS.vae,
          ];
  const phases = Object.keys(tensors) as (keyof typeof tensors)[];
  const sequential = phases.map((name, index) => ({
    name,
    bytes: tensors[name] + placement[index],
  }));
  const parallel = phases.map((name, index) => ({
    name,
    bytes: batchTensors[name] + placement[index],
  }));
  const peak = Math.max(...sequential.map((p) => p.bytes)),
    parallelPeak = Math.max(...parallel.map((p) => p.bytes));
  // One flat addition to each projected peak, never multiplied by batch size.
  const safetyBytes = profile.safetyGiB * GiB;
  const safePeak = peak + safetyBytes,
    safeParallelPeak = parallelPeak + safetyBytes;
  const budget = profile.gpuGiB * GiB;
  return {
    text,
    negativeText,
    imageTokens,
    target,
    prefix,
    negativePrefix,
    branches,
    kv,
    parallelKv: kv * input.num_images,
    tensors,
    batchTensors,
    sequential,
    parallel,
    peak,
    parallelPeak,
    safetyBytes,
    safePeak,
    safeParallelPeak,
    memoryRoute:
      safePeak > budget
        ? "likely rejected"
        : input.num_images > 1 && safeParallelPeak <= budget
          ? "parallel candidate"
          : "sequential",
  };
}
