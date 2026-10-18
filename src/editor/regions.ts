export const REGION_COLOURS = [
  "#ff304b",
  "#168bff",
  "#16b86a",
  "#f5b72a",
  "#b76aff",
  "#ff7935",
  "#16c6ca",
  "#e544b1",
];
export const REGION_NAMES = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "cyan",
  "pink",
];
export interface RegionDescription {
  id: string;
  name: string;
  colour: string;
  instruction: string;
  enabled: boolean;
  feather?: number;
}
/** Maximum union: overlap never increases coverage. */
export function unionMasks(masks: Uint8Array[], length: number): Uint8Array {
  const union = new Uint8Array(length);
  for (const mask of masks) {
    if (mask.length !== length)
      throw new Error("Region mask dimensions differ.");
    for (let i = 0; i < length; i++) union[i] = Math.max(union[i], mask[i]);
  }
  return union;
}
