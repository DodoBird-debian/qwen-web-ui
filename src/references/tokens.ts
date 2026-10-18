export interface OrderedImage {
  id: string;
}
export function remapTags(
  prompt: string,
  previous: OrderedImage[],
  next: OrderedImage[],
): string {
  return prompt.replace(/<image(\d+)>/g, (_, digits: string) => {
    const image = previous[Number(digits) - 1];
    if (!image) return `<missing:image${digits}>`;
    const index = next.findIndex((item) => item.id === image.id);
    return index === -1 ? `<missing:${image.id}>` : `<image${index + 1}>`;
  });
}
export function validateTags(prompt: string, count: number): void {
  if (prompt.includes("<missing:"))
    throw new Error("Repair missing image references in the prompt.");
  for (const match of prompt.matchAll(/<image(\d+)>/g)) {
    if (Number(match[1]) < 1 || Number(match[1]) > count)
      throw new Error(`${match[0]} has no attached reference image.`);
  }
}
export function insertAtCaret(area: HTMLTextAreaElement, value: string): void {
  area.setRangeText(value, area.selectionStart, area.selectionEnd, "end");
  area.focus();
  area.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Edit guide instructions always reserve positions 1 and 2 for source/guide. */
export function remapEditInstruction(
  text: string,
  previousUsers: OrderedImage[],
  nextUsers: OrderedImage[],
): string {
  const reserved = [{ id: "$edit-source" }, { id: "$edit-guide" }];
  return remapTags(
    text,
    [...reserved, ...previousUsers],
    [...reserved, ...nextUsers],
  );
}
