# Changes

## Unreleased

- Place validation beside Generate and keep only active/unresolved activity sticky.
- Add mode-aware source loading, paste-to-source for empty edit canvases, reference/result source selection, collapsible history and responsive editor panels.
- Consolidate image/request controls, show active presets and explicitly enable negative prompts with CFG 2.
- Add guarded generation/mode/editor shortcuts, temporary pan, pointer-anchored zoom and a scaled brush outline.
- Compact reference actions, automatically preview export/reference encoding with stale-result cleanup, and indicate the active mobile section.
- Default the calculator to model CPU offload and let saved endpoint profiles override the server hint.
- Match worker VRAM tensors and phase weight placement, expose offload beside capacity/safety, and show the peak breakdown.
- Move batch planning above settings, add image-count shortcuts and request previews/progress, and verify ten images dispatch as 4+4+2.
- Keep image history across tools and new runs, with small previews, optional reload persistence, and no automatic eviction of image jobs.
- Accept partial batches and JPEG fallback, preserve returned seeds/images, display delivery warnings, and stop remaining automation without retrying omissions.
- Map proportionally resized worker results back onto inpaint/outpaint canvases, preserving source pixels outside the edit mask.
- Keep Base and Turbo endpoints and credentials separate. Turbo locks the UI to eight steps and returning to Base restores its settings.
- Keep a newer project when browser storage is re-enabled. Recover saved jobs without overwriting their images or masks, clear the previous canvas when importing a text-only request, and reset imports to a single batch.
- Preserve the current source and intended region when uploads finish out of order. Keep region references valid across mode changes and keep seam blending off untouched outpaint edges.
- Normalize seeds with leading zeroes, submit the edited series count on the first Generate click, resolve reference aliases in Find uses, and export the exact planned requests with comparison overrides.
- Let a blank API-key field restore the server default. Keep valid images in mixed responses and record the actual format, dimensions and byte count in ZIP manifests.
- Load history summaries and recent thumbnails on startup. Fetch the full saved job on demand and deduplicate stored reference data.
- Serialize LXC activation and rollback, clean up uploaded workspaces, and retain the preceding release for rollback and lazy assets used by open tabs. Replace the self-signed certificate when the host address changes.
- Preserve the frozen request schema. The current worker can retain earlier images after a later pass fails, reports delivery changes, and handles cancellation at pass or denoising checkpoints. [Regression coverage](docs/VERIFICATION.md#regression-coverage) · [Inference and delivery](docs/inference-and-delivery.md)
- Consolidate WebUI plans and reports into the README, verification record, and inference notes. The worker proposal, frozen fixes, and optimization findings share its risk review. Original reports remain available at the audited commits. [Verification record](docs/VERIFICATION.md#documentation-consolidation)

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
