export const $ = <T extends HTMLElement = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};
export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}
export function button(
  label: string,
  action: () => void | Promise<void>,
  className = "button",
): HTMLButtonElement {
  const element = node("button", className, label);
  element.type = "button";
  let busy = false;
  element.addEventListener("click", () => {
    if (busy) return;
    busy = true;
    element.setAttribute("aria-busy", "true");
    Promise.resolve()
      .then(action)
      .catch((error) =>
        toast(error instanceof Error ? error.message : String(error), true),
      )
      .finally(() => {
        busy = false;
        element.removeAttribute("aria-busy");
      });
  });
  return element;
}
let toastTimer: ReturnType<typeof setTimeout>;
export function toast(message: string, error = false) {
  const target = document.querySelector<HTMLElement>("#toast");
  if (!target) return;
  target.textContent = message;
  target.className = `toast visible${error ? " error" : ""}`;
  target.setAttribute("role", error ? "alert" : "status");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => target.classList.remove("visible"),
    error ? 12000 : 5000,
  );
}
export function uid(): string {
  return (
    crypto.randomUUID?.() ??
    Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
      n.toString(16),
    ).join("-")
  );
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = node("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const bytesLabel = (bytes: number) =>
  `${(bytes / 1_000_000).toFixed(2)} MB`;
export const gibLabel = (bytes: number) =>
  `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
