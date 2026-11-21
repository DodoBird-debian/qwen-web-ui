import { validateTags } from "./tokens";
export interface ReferenceBinding {
  id: string;
  alias: string;
  role?: string;
  name?: string;
}
const aliasPattern = /@\{([^}]+)\}/g;
function matchingAliases(alias: string, bindings: ReferenceBinding[]) {
  return bindings.map((binding, index) => ({ binding, index }))
    .filter(({ binding }) => binding.alias.toLocaleLowerCase() === alias.toLocaleLowerCase());
}

/** Ranges refer to the text the user can select, including uncompiled aliases. */
export function referenceUses(text: string, bindings: ReferenceBinding[], index: number) {
  const ranges: { start: number; end: number }[] = [];
  for (const match of text.matchAll(/@\{([^}]+)\}|<image(\d+)>/g)) {
    const aliases = match[1] === undefined ? [] : matchingAliases(match[1], bindings);
    if (match[2] !== undefined ? Number(match[2]) === index + 1
        : aliases.length === 1 && aliases[0].index === index)
      ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}
export function compilePrompt(
  text: string,
  bindings: ReferenceBinding[],
): string {
  const resolved = text.replace(aliasPattern, (_, alias: string) => {
    const matches = matchingAliases(alias, bindings);
    if (matches.length !== 1)
      throw new Error(
        matches.length
          ? `Alias ${alias} is ambiguous; choose its image tag.`
          : `Reference alias ${alias} is missing.`,
      );
    return `<image${matches[0].index + 1}>`;
  });
  validateTags(resolved, bindings.length);
  return resolved;
}
export function roleInstruction(role: string, tag: string): string {
  const roles: Record<string, string> = {
    person: `Preserve the identity of the person in ${tag}.`,
    product: `Use the product from ${tag}; preserve its shape, logo and packaging text.`,
    style: `Use ${tag} as a visual style reference.`,
    background: `Use the scene from ${tag} as the background.`,
    clothing: `Use the clothing from ${tag}.`,
    pose: `Use ${tag} as a pose reference.`,
  };
  return roles[role] || `Use ${tag} as a reference.`;
}
