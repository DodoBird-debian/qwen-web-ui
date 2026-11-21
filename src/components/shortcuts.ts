import type { MaskEditor, Tool } from "../editor/mask-editor";
import { toast } from "../lib/dom";

export function bindShortcuts(options: {
  editor: MaskEditor;
  generate: () => Promise<void>;
  selectMode: (index: number) => void;
  selectTool: (tool: Tool) => void;
  resizeBrush: (delta: number) => void;
}) {
  const { editor } = options;
  let generating = false;
  const editing = (target: EventTarget | null) => target instanceof HTMLElement &&
    (!!target.closest("input, textarea, select") || target.isContentEditable);
  const editorFocused = () => !!document.activeElement?.closest("#canvas-viewport, #editor-tools") &&
    !!document.querySelector(".workspace-editing");
  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.isComposing || document.querySelector("dialog[open]")) return;
    const command = event.ctrlKey || event.metaKey;
    if (command && !event.altKey && !event.shiftKey && event.key === "Enter") {
      event.preventDefault();
      if (event.repeat || generating || editor.drawing) return;
      generating = true;
      void options.generate().catch(error => toast(String(error), true))
        .finally(() => { generating = false; });
      return;
    }
    if (editing(event.target) || editor.drawing) return;
    if (event.altKey && !command && !event.shiftKey && /^[1-4]$/.test(event.key)) {
      event.preventDefault();
      if (!event.repeat) options.selectMode(Number(event.key) - 1);
      return;
    }
    if (!editor.loaded || !editorFocused()) return;
    const key = event.key.toLowerCase();
    if (command && !event.altKey && (key === "z" || (key === "y" && !event.shiftKey))) {
      event.preventDefault();
      if (key === "y" || event.shiftKey) editor.redo(); else editor.undo();
    } else if (!command && !event.altKey) {
      const tools: Record<string, Tool> = { b: "brush", e: "erase", r: "rectangle", o: "ellipse", h: "pan" };
      if (tools[key]) {
        event.preventDefault();
        options.selectTool(tools[key]);
      } else if (key === "[" || key === "]") {
        event.preventDefault();
        options.resizeBrush(key === "[" ? -10 : 10);
      } else if (event.code === "Space" && event.target instanceof HTMLCanvasElement) {
        event.preventDefault();
        editor.setTemporaryPan(true);
      }
    }
  });
  document.addEventListener("keyup", event => {
    if (event.code === "Space") editor.setTemporaryPan(false);
  });
  window.addEventListener("blur", () => editor.setTemporaryPan(false));
}
