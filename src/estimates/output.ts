import type { Input } from "../api/contract";
import { MAX_SEED } from "../api/contract";

export const OUTPUT_CAP = 8_000_000;
export function pngBound(width: number, height: number): number {
  const source = height * (4 * width + 1);
  const compressed =
    source + Math.ceil(source / 8) + Math.ceil(source / 64) + 11;
  return (
    8 +
    25 +
    12 +
    compressed +
    Math.ceil(compressed / Math.max(65536, width * 4)) * 12
  );
}
export function outputBudget(input: Input) {
  if (input.output_format !== "png")
    return {
      guaranteedFit: false,
      bound: null,
      message:
        "Compressed output size is uncertain. The frozen worker routes multi-image WebP/JPEG jobs sequentially.",
    };
  const bytes = pngBound(input.width, input.height);
  // Mirrors Python json.dumps default separators; seed length uses the maximum.
  const sample = `{"model": "Qwen/Qwen-Image-2.1", "revision": "790c92633540aa0cb11d9abf19eb46d861714758", "parameters": {"num_inference_steps": ${input.num_inference_steps}, "true_cfg_scale": ${Number.isInteger(input.true_cfg_scale) ? input.true_cfg_scale.toFixed(1) : input.true_cfg_scale}, "output_resolution": ${input.output_resolution}, "use_kv_cache": ${input.use_kv_cache}}, "images": [${Array.from({ length: input.num_images }, () => `{"image_base64": "", "mime_type": "image/png", "width": ${input.width}, "height": ${input.height}, "seed": ${MAX_SEED}}`).join(", ")}], "inference_seconds": 0.0}`;
  const bound =
    new TextEncoder().encode(sample).length +
    input.num_images * 4 * Math.ceil(bytes / 3);
  const guaranteedFit = bound <= OUTPUT_CAP - 8192;
  return {
    guaranteedFit,
    bound,
    message: guaranteedFit
      ? "PNG transport bound fits the pinned encoder/profile."
      : "PNG transport fit is uncertain; multiple outputs will route sequentially. Large results can still exceed the 8 MB output cap.",
  };
}
