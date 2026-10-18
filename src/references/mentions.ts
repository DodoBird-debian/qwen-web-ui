import { button, node } from "../lib/dom";
import { insertAtCaret } from "./tokens";
import type { ReferenceBinding } from "./prompt-compiler";
export function bindMentions(
  areas: HTMLTextAreaElement[],
  root: HTMLElement,
  bindings: () => (ReferenceBinding & { url?: string })[],
) {
  let active = areas[0],
    selected = 0,
    replaceStart = 0;
  function refresh(force = false) {
    const before = active.value.slice(0, active.selectionStart),
      match = before.match(/<(?:image\d*)?$|@([^\s@<>]*)$/);
    const entries = bindings().map((b, i) => ({ ...b, index: i }));
    const query = match?.[1]?.toLowerCase() || "";
    const filtered = entries.filter(
      (b) =>
        !query ||
        `${b.alias} ${b.role} image${b.index + 1}`
          .toLowerCase()
          .includes(query),
    );
    root.replaceChildren();
    root.hidden = !filtered.length || (!force && !match);
    if (root.hidden) return;
    replaceStart = match
      ? active.selectionStart - match[0].length
      : active.selectionStart;
    selected = Math.min(selected, filtered.length - 1);
    filtered.forEach((b, i) => {
      const item = button(
        "",
        () => {
          active.setSelectionRange(replaceStart, active.selectionEnd);
          insertAtCaret(active, `<image${b.index + 1}>`);
          root.hidden = true;
        },
        "mention-option",
      );
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(i === selected));
      if (b.url) {
        const img = node("img");
        img.src = b.url;
        img.alt = "";
        item.append(img);
      }
      item.append(
        node(
          "span",
          "",
          `${b.alias} · ${b.role || "reference"} · <image${b.index + 1}>`,
        ),
      );
      // Keep textarea caret and selection while picking a mention.
      item.onmousedown = (e) => e.preventDefault();
      root.append(item);
    });
  }
  root.setAttribute("role", "listbox");
  root.setAttribute("aria-label", "Reference suggestions");
  for (const area of areas) {
    area.addEventListener("focus", () => {
      active = area;
    });
    area.addEventListener("input", () => {
      active = area;
      selected = 0;
      refresh();
    });
    area.addEventListener("keydown", (e) => {
      if (root.hidden) return;
      if (e.key === "Escape") {
        root.hidden = true;
        e.preventDefault();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        selected =
          (selected + (e.key === "ArrowDown" ? 1 : -1) + root.children.length) %
          root.children.length;
        [...root.children].forEach((n, i) =>
          n.setAttribute("aria-selected", String(i === selected)),
        );
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        (root.children[selected] as HTMLButtonElement)?.click();
      }
    });
    const highlight = () => {
      const prefix = area.value.slice(0, area.selectionStart),
        m = prefix.match(/<image(\d+)>?$/);
      const id = m ? bindings()[Number(m[1]) - 1]?.id : undefined;
      document
        .querySelectorAll<HTMLElement>("[data-reference-id]")
        .forEach((el) =>
          el.classList.toggle(
            "reference-highlight",
            el.dataset.referenceId === id,
          ),
        );
    };
    area.addEventListener("click", highlight);
    area.addEventListener("keyup", highlight);
  }
  return {
    open() {
      refresh(true);
    },
  };
}
