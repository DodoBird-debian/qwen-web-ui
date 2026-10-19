# Changes

## Unreleased

- Use model CPU offload for the configured server worker, overriding stale browser offload profiles while preserving capacity and safety.
- Match worker VRAM tensors and phase weight placement, expose offload beside capacity/safety, and show the peak breakdown.
- Move batch planning above settings, add image-count shortcuts and request previews/progress, and verify ten images dispatch as 4+4+2.
- Keep image history across tools and new runs, with small previews, optional reload persistence, and no automatic eviction of image jobs.
- Accept partial batches and JPEG fallback, preserve returned seeds/images, display delivery warnings, and stop remaining automation without retrying omissions.
- Map proportionally resized worker results back onto inpaint/outpaint canvases, preserving source pixels outside the edit mask.

## 1.2.1 — 2026-10-18

- Block duplicate paid submissions after paused polling, ambiguous responses and reloads; recover known/expired jobs without redispatch.
- Preserve accepted job IDs before persistence, validate polling responses and retain terminal runner errors.
- Reuse result cards/URLs and metadata-only edit preparations; serialize and coalesce heavy guide preparation.
- Bound composite scratch work to rows, release intermediate canvases/bitmaps, and cancel obsolete export ladders.
- Prune history through summaries/index keys with an in-place IndexedDB v1-to-v2 upgrade.
- Improve touch controls, phone navigation, portrait/landscape layouts and usable editing-canvas space.
- Keep execution, resource preparation and mobile navigation in independent modules; add regression coverage and an audit report.

## 1.2.0 — 2026-10-18

- Combine coloured region annotations with inpainting, independent instructions,
  region ordering, undo/redo, and global/per-region feathering.
- Add single-pass outpainting with side/ratio/anchor controls and protected source pixels.
- Visibly display both raw worker output and local composite with independent actions.
- Add reference aliases/roles, thumbnail autocomplete, instruction helpers and stable tags,
  including custom edit-guide instructions when references are reordered.
- Add finite consecutive-seed series (up to 100 images, 1/4 per request) and parameter
  grids (up to 64 cells), stop/cancel controls, exact seeds and full session collections.
- Estimate the most demanding planned request without changing worker scheduling.
- Add shared fullscreen/zoom/alpha inspection, mapped comparisons, browser exports,
  bounded target-size compression, ZIP downloads and contact sheets.
- Default to session memory; browser persistence is explicit and existing saved data
  remains available. Keep storage/execution/editing/export responsibilities separate.
- Keep the frozen worker/API unchanged and production hosting Nginx-only.
- Defer the general queue, standalone sketch editor, presets and portable project bundles.
