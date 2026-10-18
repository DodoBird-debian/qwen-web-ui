import type { Reference } from "../references/images";
import { bytesLabel, button, node } from "../lib/dom";

export function renderGuides(
  root: HTMLElement,
  references: Reference[],
  insert: (index: number) => void,
) {
  root.replaceChildren();
  references.forEach((reference, index) => {
    const item = node("article", "reference-card guide-card");
    const image = node("img");
    image.src = reference.url;
    image.alt = reference.name;
    const info = node("div", "reference-info");
    info.append(
      node("strong", "", `<image${index + 1}>`),
      node("span", "filename", reference.name),
      node(
        "small",
        "",
        `${reference.width}×${reference.height} · ${bytesLabel(reference.base64.length)} base64`,
      ),
    );
    item.append(
      image,
      info,
      button("Insert guide tag ↗", () => insert(index), "text-button"),
    );
    root.append(item);
  });
}

export function renderReferences(
  root: HTMLElement,
  references: Reference[],
  offset: number,
  actions: {
    insert: (index: number) => void;
    move: (index: number, delta: number) => void;
    remove: (index: number) => void;
    source: (index: number) => void;
    compress: (index: number) => void;
    update: (index: number, patch: {alias?: string; role?: string}) => void;
    helper: (index: number) => void;
    find: (index: number) => void;
    uses: (index: number) => number;
  },
) {
  root.replaceChildren();
  references.forEach((reference, index) => {
    const item = node("article", "reference-card"),
      image = node("img");
    image.src = reference.url;
    image.alt = reference.name;
    const main = node("div", "reference-info");
    main.append(
      node("strong", "", `<image${index + offset + 1}>`),
      node("span", "filename", reference.name),
      node(
        "small",
        "",
        `${reference.width}×${reference.height} · ${bytesLabel(reference.base64.length)} base64`,
      ),
    );
    item.dataset.referenceId = reference.id;
    const alias = node("input"); alias.value = reference.alias || reference.name; alias.setAttribute("aria-label", `Reference ${index + 1} alias`); alias.maxLength=80; alias.onchange = () => actions.update(index,{alias:alias.value.trim() || reference.name});
    const role = node("select"); role.setAttribute("aria-label", `Reference ${index + 1} role`);
    for (const value of ["", "person", "product", "style", "background", "clothing", "pose"]) { const option=node("option", "", value || "Reference role"); option.value=value; role.append(option); }
    role.value=reference.role || ""; role.onchange=()=>actions.update(index,{role:role.value});
    const uses=node("small", "", `${actions.uses(index)} prompt uses`); uses.dataset.referenceUses=reference.id; main.append(alias, role, uses);
    const tools = node("div", "reference-tools");
    const up = button("↑", () => actions.move(index, -1), "icon-button"),
      down = button("↓", () => actions.move(index, 1), "icon-button");
    up.disabled = index === 0;
    down.disabled = index === references.length - 1;
    up.title = "Move reference up";
    down.title = "Move reference down";
    tools.append(
      button("Insert ↗", () => actions.insert(index), "text-button"),
      up,
      down,
      button("×", () => actions.remove(index), "icon-button"),
    );
    const extra = node("div", "reference-extra");
    extra.append(
      button("Resize / encode", () => actions.compress(index), "text-button"),
      button("Use as source", () => actions.source(index), "text-button"),
      button("Insert instruction", () => actions.helper(index), "text-button"),
      button("Find uses", () => actions.find(index), "text-button"),
    );
    item.append(image, main, tools, extra);
    root.append(item);
  });
}
