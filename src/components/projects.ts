import { $, node, button, toast, uid } from "../lib/dom";
import { put, list, remove, persistenceEnabled } from "../storage/db";
import type { Input } from "../api/contract";

export interface Project {
  schemaVersion?: 2;
  id: string;
  created: number;
  title: string;
  mode: "generate" | "edit" | "inpaint";
  input: Input;
  references: {
    id: string;
    name: string;
    blob: Blob;
    alias?: string;
    role?: string;
  }[];
  regions?: import("../editor/mask-editor").SavedRegion[];
  expansion?: import("../editor/outpaint").Expansion;
  source?: Blob;
  mask?: Blob;
  crop: boolean;
  padding: string;
  feather: string;
  instruction: string;
}
export function bindProjects(context: {
  dialog: (title: string) => HTMLElement;
  capture: () => Promise<Omit<Project, "id" | "created" | "title">>;
  restore: (project: Project) => Promise<void>;
}) {
  let selected: string | undefined;
  $("#save-project").addEventListener("click", async () => {
    try {
      const snapshot = await context.capture(),
        id = selected || uid();
      await put("projects", {
        ...snapshot,
        id,
        created: Date.now(),
        title: snapshot.input.prompt.slice(0, 60) || "Untitled project",
      });
      selected = id;
      toast(
        persistenceEnabled()
          ? "Project saved in this browser."
          : "Project saved in this session. Enable browser storage to keep it after reload.",
      );
    } catch {
      toast(
        "Unable to save project. Browser storage may be unavailable or full.",
        true,
      );
    }
  });
  $("#project-open").addEventListener("click", async () => {
    const body = context.dialog("Local projects");
    try {
      const projects = await list<Project>("projects");
      if (!projects.length)
        body.append(node("p", "subtle", "No saved projects yet."));
      for (const project of projects) {
        const item = node("article", "history-item");
        item.append(
          node("strong", "", project.title),
          node("small", "subtle", new Date(project.created).toLocaleString()),
        );
        item.append(
          button("Open", async () => {
            await context.restore(project);
            selected = project.id;
            $<HTMLDialogElement>("#content-dialog").close();
          }),
          button(
            "Delete",
            async () => {
              await remove("projects", project.id);
              item.remove();
              if (selected === project.id) selected = undefined;
            },
            "text-button",
          ),
        );
        body.append(item);
      }
    } catch {
      body.append(
        node("p", "notice", "Browser project storage is unavailable."),
      );
    }
  });
}
