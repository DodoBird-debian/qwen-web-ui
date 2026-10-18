import { safeFilename } from "./encode";
export interface ArchiveItem {
  name: string;
  blob: Blob;
  metadata?: unknown;
}
export async function createArchive(items: ArchiveItem[]): Promise<Blob> {
  if (!items.length || items.length > 100)
    throw new Error("Select 1–100 images to export.");
  if (items.reduce((n, i) => n + i.blob.size, 0) > 100_000_000)
    throw new Error(
      "Selected files exceed the 100 MB browser ZIP limit. Export fewer images at a time.",
    );
  const { zipSync, strToU8 } = await import("fflate");
  const files: Record<string, Uint8Array> = {};
  for (const [i, item] of items.entries())
    files[`${String(i + 1).padStart(3, "0")}-${safeFilename(item.name)}`] =
      new Uint8Array(await item.blob.arrayBuffer());
  files["manifest.json"] = strToU8(
    JSON.stringify(
      {
        schemaVersion: 1,
        images: items.map((i, index) => ({
          file: `${String(index + 1).padStart(3, "0")}-${safeFilename(i.name)}`,
          metadata: i.metadata,
        })),
      },
      null,
      2,
    ),
  );
  // Encoded image formats are already compressed. Store instead of recompressing them.
  const bytes = zipSync(files, { level: 0 });
  return new Blob([new Uint8Array(bytes)], { type: "application/zip" });
}
