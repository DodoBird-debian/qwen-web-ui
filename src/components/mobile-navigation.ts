import { button, node } from "../lib/dom";
/** Navigation only: feature state stays with its existing module. */
export function bindMobileNavigation() {
  const nav = node("nav", "mobile-navigation");
  nav.setAttribute("aria-label", "Workspace sections");
  const sections: { section: HTMLElement; button: HTMLButtonElement }[] = [];
  for (const [label, selector] of [
    ["Workspace", ".workspace"],
    ["References", ".reference-sidebar"],
    ["Settings", ".settings-sidebar"],
  ]) {
    const section = document.querySelector<HTMLElement>(selector)!;
    section.id ||= `mobile-${label.toLowerCase()}`;
    const item = button(
        label,
        () => {
          section.scrollIntoView({ block: "start" });
          activate(section);
        },
        "text-button",
      );
    item.setAttribute("aria-controls", section.id);
    sections.push({ section, button: item });
    nav.append(item);
  }
  document.body.append(nav);
  function activate(section: HTMLElement) {
    for (const entry of sections) {
      if (entry.section === section) entry.button.setAttribute("aria-current", "location");
      else entry.button.removeAttribute("aria-current");
    }
  }
  let scheduled = false;
  const update = () => {
    scheduled = false;
    if (!matchMedia("(max-width: 600px)").matches) return;
    const y = innerHeight * 0.3;
    const current = sections.find(({ section }) => {
      const box = section.getBoundingClientRect();
      return box.top <= y && box.bottom > y;
    }) || sections.reduce((best, entry) =>
      Math.abs(entry.section.getBoundingClientRect().top - y) <
      Math.abs(best.section.getBoundingClientRect().top - y) ? entry : best);
    activate(current.section);
  };
  const schedule = () => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
  };
  document.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  new ResizeObserver(schedule).observe(document.querySelector(".studio")!);
  const count = document.querySelector("#reference-count")!;
  const updateCount = () => {
    // Count user references, rather than the two generated edit guides.
    const total = document.querySelectorAll("#references .reference-card").length;
    sections[1].button.textContent = `References (${total})`;
  };
  new MutationObserver(updateCount).observe(count, { childList: true, characterData: true, subtree: true });
  updateCount();
  update();
}
