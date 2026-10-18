import { exactInteger, json, LosslessNumber } from "./json";

export const SOURCE_COMMIT = "99c28f5d8a7fe0a5fa489ef4d619b1453198fccb";
export const MAX_REQUEST_BYTES = 10_000_000;
export const MAX_SEED = 9223372036854775807n;
export const ASPECTS: Record<string, [number, number]> = {
  "1:1": [2048, 2048],
  "4:3": [2400, 1792],
  "3:4": [1792, 2400],
  "3:2": [2528, 1696],
  "2:3": [1696, 2528],
  "16:9": [2752, 1536],
  "9:16": [1536, 2752],
};
export interface Input {
  prompt: string;
  width: number;
  height: number;
  num_inference_steps: number;
  seed: string;
  num_images: number;
  images: string[];
  transparent: boolean;
  output_format: "png" | "webp" | "jpeg";
  quality: number;
  true_cfg_scale: number;
  negative_prompt?: string;
  output_resolution: number;
  use_kv_cache: boolean;
}
export const DEFAULTS: Input = {
  prompt: "",
  width: 1024,
  height: 1024,
  num_inference_steps: 40,
  seed: "-1",
  num_images: 1,
  images: [],
  transparent: false,
  output_format: "png",
  quality: 95,
  true_cfg_scale: 1,
  output_resolution: 1024,
  use_kv_cache: true,
};
const ALLOWED = new Set([
  ...Object.keys(DEFAULTS),
  "aspect_ratio",
  "negative_prompt",
]);
function int(value: unknown, name: string, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}
export function validText(
  value: unknown,
  name: string,
  required = false,
): string {
  if (
    typeof value !== "string" ||
    [...value].length > 20_000 ||
    (required && !value.trim())
  )
    throw new Error(
      `${name} must ${required ? "contain 1–20,000" : "be a string of at most 20,000"} characters.`,
    );
  // TextEncoder replaces lone surrogates. Reject before it can silently repair input.
  if (
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      value,
    )
  )
    throw new Error(`${name} contains invalid Unicode.`);
  if (value.includes("<|image_pad|>"))
    throw new Error(`${name} contains a reserved model placeholder.`);
  return value;
}
export function normalizeInput(raw: unknown): Input {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("input must be an object.");
  const data = raw as Record<string, any>;
  const unknown = Object.keys(data).filter((key) => !ALLOWED.has(key));
  if (unknown.length)
    throw new Error(`Unknown worker fields: ${unknown.join(", ")}.`);
  const value: Record<string, any> = { ...DEFAULTS, ...data };
  if ("aspect_ratio" in data) {
    if ("width" in data || "height" in data)
      throw new Error("Use aspect_ratio or width/height, not both.");
    if (typeof data.aspect_ratio !== "string" || !ASPECTS[data.aspect_ratio])
      throw new Error("Unknown aspect ratio.");
    [value.width, value.height] = ASPECTS[data.aspect_ratio];
  } else if ("width" in data !== "height" in data)
    throw new Error("Supply both width and height.");
  value.width = int(value.width, "width", 256, 4096);
  value.height = int(value.height, "height", 256, 4096);
  if (value.width % 32 || value.height % 32)
    throw new Error("Dimensions must be multiples of 32.");
  if (value.width * value.height > 4_500_000)
    throw new Error("Output must total at most 4,500,000 pixels.");
  value.prompt = validText(value.prompt, "prompt", true).trim();
  value.num_inference_steps = int(value.num_inference_steps, "steps", 1, 100);
  value.num_images = int(value.num_images, "image count", 1, 4);
  value.quality = int(value.quality, "quality", 1, 100);
  value.output_resolution = int(
    value.output_resolution,
    "reference resolution",
    512,
    2048,
  );
  if (![512, 1024, 2048].includes(value.output_resolution))
    throw new Error("Reference resolution must be 512, 1024 or 2048.");
  if (
    typeof value.true_cfg_scale !== "number" ||
    !Number.isFinite(value.true_cfg_scale) ||
    value.true_cfg_scale < 1 ||
    value.true_cfg_scale > 20
  )
    throw new Error("CFG must be between 1 and 20.");
  for (const field of ["transparent", "use_kv_cache"])
    if (typeof value[field] !== "boolean")
      throw new Error(`${field} must be boolean.`);
  if (!["png", "webp", "jpeg"].includes(value.output_format))
    throw new Error("Output format must be png, webp or jpeg.");
  if (value.transparent && value.output_format === "jpeg")
    throw new Error("Transparency requires PNG or WebP.");
  if (value.negative_prompt != null) {
    validText(value.negative_prompt, "negative prompt");
    if (value.true_cfg_scale <= 1)
      throw new Error("Negative prompt requires CFG greater than 1.");
  } else if (value.true_cfg_scale > 1) value.negative_prompt = "";
  else delete value.negative_prompt;
  value.seed = exactInteger(value.seed, "seed");
  if (BigInt(value.seed) < -1n || BigInt(value.seed) > MAX_SEED)
    throw new Error("Seed must be -1 or 0 through 9223372036854775807.");
  if (
    !Array.isArray(value.images) ||
    value.images.length > 10 ||
    value.images.some((image: unknown) => typeof image !== "string" || !image)
  )
    throw new Error("Supply up to ten non-empty base64 references.");
  if (
    value.images.reduce((sum: number, image: string) => sum + image.length, 0) >
    MAX_REQUEST_BYTES
  )
    throw new Error("Combined base64 references exceed 10,000,000 characters.");
  delete value.aspect_ratio;
  return value as Input;
}
export function effectivePrompt(input: Input): string {
  return input.transparent
    ? `This is an RGBA image with transparency. ${input.prompt} The image has alpha channel and the background is transparent.`
    : input.prompt;
}
export function prepare(input: unknown): {
  body: string;
  bytes: number;
  input: Input;
} {
  const normalized = normalizeInput(input);
  const body = json({
    input: { ...normalized, seed: new LosslessNumber(normalized.seed) },
  });
  const bytes = new TextEncoder().encode(body).length;
  if (bytes > MAX_REQUEST_BYTES)
    throw new Error(
      `Request is ${bytes.toLocaleString()} bytes; maximum is 10,000,000.`,
    );
  return { body, bytes, input: normalized };
}
export function nextSeed(seed: string, offset: number): string {
  return ((BigInt(seed) + BigInt(offset)) % (MAX_SEED + 1n)).toString();
}
export function randomSeed(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(2));
  return ((BigInt(bytes[0] & 0x7fffffff) << 32n) | BigInt(bytes[1])).toString();
}
