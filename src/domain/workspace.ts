import type { Input } from "../api/contract";
/** Schema seam for later presets. No credentials, object URLs or mutable canvases. */
export interface WorkspaceDescription {
  schemaVersion: 2;
  mode: "generate" | "edit" | "inpaint";
  settings: Omit<Input, "images">;
  references: { id: string; alias: string; role: string }[];
}
export interface ResultLocation {
  runId: string;
  cellId: string;
  label: string;
}
