import {
  parse,
  stringify,
  LosslessNumber,
  isLosslessNumber,
} from "lossless-json";

// Safe numbers stay numbers; unsafe integers retain their original decimal text.
export function parseJson(text: string): any {
  return parse(text, undefined, (value) => {
    const number = Number(value);
    return /^-?\d+$/.test(value) && !Number.isSafeInteger(number)
      ? new LosslessNumber(value)
      : number;
  });
}
export function json(value: unknown, pretty = false): string {
  const result = stringify(value, undefined, pretty ? 2 : undefined);
  if (result === undefined) throw new Error("Cannot serialize this request.");
  return result;
}
export function exactInteger(value: unknown, name: string): string {
  const text = isLosslessNumber(value) ? value.value : String(value);
  if (
    !/^-?\d+$/.test(text) ||
    (typeof value === "number" && !Number.isSafeInteger(value))
  ) {
    throw new Error(`${name} must be an exact decimal integer.`);
  }
  return BigInt(text).toString();
}
export { LosslessNumber };
