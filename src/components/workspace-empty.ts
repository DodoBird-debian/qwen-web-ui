import { $ } from "../lib/dom";

/** Keep the action card mounted so refreshes preserve keyboard focus. */
export class WorkspaceEmptyState {
  private editing = false;
  constructor(actions: { browse: (source: boolean) => void; choose: () => void }) {
    $("#empty-browse").addEventListener("click", () => actions.browse(this.editing));
    $("#empty-choose").addEventListener("click", actions.choose);
  }
  update(mode: "generate" | "edit" | "inpaint", extending: boolean, hasReferences: boolean, hasSources: boolean) {
    this.editing = mode === "inpaint";
    const needsImage = this.editing || mode === "edit";
    $("#generate-empty").hidden = needsImage;
    $("#edit-empty").hidden = !needsImage;
    $("#edit-empty-title").textContent = this.editing
      ? `Load a source image to ${extending ? "extend" : "edit"}`
      : hasReferences ? "Describe how your images should change" : "Add a reference image";
    $("#edit-empty-description").textContent = this.editing
      ? "Drop an image here, paste an image, or browse for a source."
      : "Drop, paste, or browse images to add references. Use @ or <image1> in your prompt to describe the change.";
    $("#empty-browse").textContent = this.editing ? "Browse source image" : "Add references";
    $("#empty-choose").hidden = !this.editing;
    $<HTMLButtonElement>("#empty-choose").disabled = !hasSources;
  }
}
