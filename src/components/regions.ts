import { button, node } from "../lib/dom";
import type { MaskEditor } from "../editor/mask-editor";
export function bindRegions(root: HTMLElement, editor: MaskEditor) {
  function render() {
    root.replaceChildren();
    if (!editor.loaded) return;
    const head = node("div", "section-heading");
    head.append(
      node("strong", "", "Edit regions"),
      button("+ Region", () => editor.add(), "text-button"),
    );
    root.append(head);
    const note = node(
      "small",
      "subtle",
      "Later regions take priority in overlaps. Colour guides never enter the local composite.",
    );
    root.append(note);
    for (const [i, r] of editor.regions.entries()) {
      const row = node(
        "div",
        `region-row${r.id === editor.selected ? " selected" : ""}`,
      );
      const select = button(
        `${i + 1} · ${r.name}`,
        () => editor.select(r.id),
        "region-select",
      );
      select.style.borderLeft = `5px solid ${r.colour}`;
      select.setAttribute("aria-pressed", String(r.id === editor.selected));
      const enabled = node("input");
      enabled.type = "checkbox";
      enabled.checked = r.enabled;
      enabled.setAttribute("aria-label", `Enable ${r.name}`);
      enabled.onchange = () =>
        editor.update(r.id, { enabled: enabled.checked });
      const name = node("input");
      name.value = r.name;
      name.setAttribute("aria-label", `Region ${i + 1} name`);
      name.onchange = () =>
        editor.update(r.id, { name: name.value.slice(0, 80) });
      const instruction = node("textarea");
      instruction.rows = 2;
      instruction.value = r.instruction;
      instruction.placeholder = "What should change in this region?";
      instruction.setAttribute("aria-label", `Region ${i + 1} instruction`);
      instruction.onchange = () =>
        editor.update(r.id, { instruction: instruction.value });
      const featherLabel = node(
          "label",
          "field",
          "Region feather (px; empty inherits global)",
        ),
        feather = node("input");
      feather.type = "number";
      feather.min = "0";
      feather.max = "100";
      feather.placeholder = "Global";
      feather.value = r.feather === undefined ? "" : String(r.feather);
      feather.setAttribute("aria-label", `Region ${i + 1} feather`);
      feather.onchange = () => {
        const value = feather.value === "" ? undefined : Number(feather.value);
        if (
          value !== undefined &&
          (!Number.isInteger(value) || value < 0 || value > 100)
        ) {
          feather.setCustomValidity("Use whole pixels from 0 to 100.");
          feather.reportValidity();
          return;
        }
        feather.setCustomValidity("");
        editor.update(r.id, { feather: value });
      };
      featherLabel.append(feather);
      const actions = node("div", "button-row");
      const up = button("↑", () => editor.moveRegion(r.id, -1), "icon-button"),
        down = button("↓", () => editor.moveRegion(r.id, 1), "icon-button");
      up.disabled = i === 0;
      down.disabled = i === editor.regions.length - 1;
      actions.append(
        enabled,
        up,
        down,
        button("Delete", () => editor.remove(r.id), "text-button"),
      );
      row.append(select, name, instruction, featherLabel, actions);
      root.append(row);
    }
  }
  editor.onRegionsChange(render);
  render();
}
