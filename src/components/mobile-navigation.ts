import { button, node } from "../lib/dom";
/** Navigation only: feature state stays with its existing module. */
export function bindMobileNavigation() {
  const nav = node("nav", "mobile-navigation");
  nav.setAttribute("aria-label", "Workspace sections");
  for (const [label, selector] of [
    ["Workspace", ".workspace"],
    ["References", ".reference-sidebar"],
    ["Settings", ".settings-sidebar"],
  ]) {
    nav.append(
      button(
        label,
        () => {
          document.querySelector(selector)?.scrollIntoView({ block: "start" });
        },
        "text-button",
      ),
    );
  }
  document.body.append(nav);
}
