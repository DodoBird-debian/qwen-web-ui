import { prepareEdit, type EditOptions } from "../editor/prepare-edit";
import type { MaskEditor } from "../editor/mask-editor";
import type { PreparedInpaint } from "../editor/inpaint";
import { releaseReference } from "../references/images";
/** Serializes expensive canvas preparation and skips superseded queued revisions. */
export class EditPreparationCache {
  private current?: { key: string; value: Promise<PreparedInpaint> };
  private work: Promise<unknown> = Promise.resolve();
  constructor(
    private prepare = prepareEdit,
    private release = (value: PreparedInpaint) =>
      value.references.forEach(releaseReference),
  ) {}
  get(editor: MaskEditor, options: EditOptions): Promise<PreparedInpaint> {
    const key = `${editor.sourceId}:${editor.pixelRevision}:${JSON.stringify(options)}`;
    if (this.current?.key === key) return this.current.value;
    this.clear();
    const entry = {
      key,
      value: this.work.then(() => {
        if (this.current !== entry)
          throw new DOMException("Obsolete preparation", "AbortError");
        return this.prepare(editor, options);
      }),
    };
    this.current = entry;
    this.work = entry.value.catch(() => {
      if (this.current === entry) this.current = undefined;
    });
    return entry.value;
  }
  clear() {
    this.current?.value.then(this.release).catch(() => {});
    this.current = undefined;
  }
}
