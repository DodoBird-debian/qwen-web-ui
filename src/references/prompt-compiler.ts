import { validateTags } from "./tokens";
export interface ReferenceBinding {
  id: string;
  alias: string;
  role?: string;
  name?: string;
}
export function compilePrompt(
  text: string,
  bindings: ReferenceBinding[],
): string {
  const resolved = text.replace(/@\{([^}]+)\}/g, (_, alias: string) => {
    const matches = bindings
      .map((b, i) => ({ b, i }))
      .filter(
        ({ b }) => b.alias.toLocaleLowerCase() === alias.toLocaleLowerCase(),
      );
    if (matches.length !== 1)
      throw new Error(
        matches.length
          ? `Alias ${alias} is ambiguous; choose its image tag.`
          : `Reference alias ${alias} is missing.`,
      );
    return `<image${matches[0].i + 1}>`;
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
