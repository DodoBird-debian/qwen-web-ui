# Browser-side editing and generation tools: implementation plan

Status: implemented in WebUI 1.2.0. See README.md and VERIFICATION.md for behavior,
limits and verification. The worker remains unchanged. The original approved design
below records the scope; repository seams live in state/ and storage/, and grid planning
shares generation/plan.ts rather than a separate comparison package.

## Scope and boundaries

Implement combined coloured-region inpainting, useful reference insertion, outpainting,
finite repeated generation, parameter grids, result inspection, and export preparation.
Explain sketch references, but defer a separate sketch editor unless requested.

Keep the worker repository and frozen API unchanged. Production hosting remains static
assets plus the existing restricted Nginx RunPod proxy. Images, masks, prompt preparation,
run planning, compositing, inspection, and export run in the user's browser. No server
database, background scheduler, additional inference model, or external prompt service.

Defer a general queue, presets UI, portable project bundles, shared storage, and a new
clear-state workflow. A ZIP of selected finished images is an export, not a project bundle.

## Existing implementation to reuse

- `api/contract.ts`: strict request normalization, exact UTF-8 request budgeting,
  lossless seed serialization, and consecutive-seed arithmetic.
- `api/runpod.ts`: async submission, polling, cancellation, and worker-error detection.
- `api/jobs.ts`: job execution and result decoding. Currently imports persistence and
  compositing directly; separate those responsibilities before adding run orchestration.
- `references/tokens.ts`: tag insertion, reorder remapping, and missing-reference errors.
- `editor/mask-editor.ts`, `editor/inpaint.ts`, `editor/geometry.ts`: drawing, guide
  preparation, crop mapping, feathering, and alpha-aware local compositing.
- `components/results.ts`: raw/composite/source views and per-image downloads.
- `storage/db.ts`: existing optional browser persistence, currently called directly.

The existing separate-output loop handles at most the requested one-to-four images;
it is not yet a repeat-run controller and replaces the visible job after each submission.

## 1. Separate domain state, runtime resources, and persistence

Introduce small typed modules instead of expanding `app.ts`:

```text
src/
  domain/
    assets.ts                Stable IDs and image metadata
    workspace.ts             Versioned serializable workspace description
    results.ts               Raw results and derivative provenance
  state/
    session.ts               In-memory state and subscriptions
    repository.ts            Optional persistence interfaces
    memory-repository.ts     Default, browser session only
    indexeddb-repository.ts  Adapter for existing opt-in local persistence
  references/
    registry.ts              Stable asset bindings and reference order
    mentions.ts              Alias lookup, suggestions, insertion, validation
    prompt-compiler.ts       Resolve mentions to <imageN>; append explicit role instructions
  editor/
    document.ts              Source, regions, instructions, mode, transforms
    regions.ts               Region geometry, masks, overlap and union
    annotation-renderer.ts   Render clean source plus coloured guide
    prepare-edit.ts          Worker-compatible inpaint/outpaint preparation
    outpaint.ts              Expanded canvas geometry and editable area
    compositor.ts            Apply generated pixels through final mask
  generation/
    snapshot.ts              Immutable run configuration and asset ownership
    plan.ts                  One image-to-cell mapping and legal request grouping
    series.ts                Consecutive-seed repeated generation planner
    runner.ts                One active remote request at a time
    validation.ts            Every request and total-run preflight
  comparison/
    grid-plan.ts             Axis values and reproducible comparison seeds
    grid-view.ts             Labelled cells, missing results, result selection
  inspection/
    viewer.ts                Fullscreen/keyboard/touch interaction
    viewport.ts              Fit, 100%, zoom, pan and synchronized transforms
    compare.ts               Slider, side-by-side and differences
    alpha.ts                 Alpha visualization and backgrounds
  export/
    options.ts               Export specifications and validation
    encode.ts                PNG/WebP/JPEG derivative encoding
    target-size.ts           Bounded target-size search
    archive.ts               ZIP and lightweight result manifest
    contact-sheet.ts         Labelled grid/series image export
  components/                Thin UI controllers for these modules
```

This is a responsibility map, not a requirement to create empty files. Keep closely
related code together until it warrants a separate module. Retain the pure contract,
geometry, and estimator modules rather than building a generic framework.

State decisions:

- New work defaults to in-memory session state. Reload ends local pending automation.
- Introduce an explicit optional browser-persistence setting; existing saved data is
  preserved and available when that adapter is enabled. Do not delete or silently
  migrate away existing projects/history. No clear-state feature in this work.
- API keys remain in tab memory, outside serializable domain data and storage adapters.
- Runtime Blob URLs, canvases, ImageBitmaps, AbortControllers, and credentials do not
  belong in serializable workspace descriptions. Own and dispose them explicitly.
- Snapshot assets are immutable or reference-counted: changing/removing a reference
  while a series runs must not revoke resources the active run still needs.
- Use schema versions and stable IDs so future presets can reference settings and
  roles without changing request compilation or embedding credentials/base64 everywhere.
- Persistence failures must not discard completed outputs. Active-series results are
  pinned against ordinary history trimming; its current limit of 12 cannot drop the
  first results of a 20-image run.

## 2. Reference insertion that is useful beyond a numbered button

Keep literal `<image1>` through `<image10>` support, including imports. Add:

- Editable alias, optional role, thumbnail, current final tag, and use count per image.
- `@` and `<image` autocomplete with thumbnail + alias + role + resolved tag; keyboard
  navigation, Enter to select, Escape to close, and caret-safe insertion.
- Click/focus a mention to highlight the corresponding reference; click a reference
  to find its uses. Show missing references before submitting.
- Explicit helpers such as “Use person from …”, “Use style from …”, and “Place product
  from … into scene from …”. These insert editable instructions, not hidden behavior.
- A final prompt/reference preview, including generated source/guide references.

Use stable reference IDs internally for newly inserted mentions. Compile them to the
actual positional tags immediately before request validation. A lightweight text model
with mention spans is sufficient; avoid a large rich-text editor dependency. Arbitrary
manual edits reconcile mention spans, and pasted numeric tags bind against the current
reference order. Alias rename and duplicate display names cannot retarget a mention.

Inpaint/outpaint reserve source and guide positions in one registry. Switching modes
remaps tags without changing image identity. Replacing the source creates a new asset
identity; do not silently bind old source mentions to unrelated pixels. Missing bindings
require repair. Compile all relevant text fields, including region instructions and a
negative prompt when CFG permits it.

Role names and aliases are UI data. Never send `role`, `alias`, or custom mention
syntax as worker fields. Preserve user-authored instructions; role helpers operate
only when explicitly selected.

## 3. Combine coloured annotations with inpainting

One Edit workspace and canvas, with a region list beside it. Each region has:

- Stable ID, distinct colour and readable label, editable instruction, enabled state,
  brush/erase/rectangle/ellipse geometry, and optional feather override.
- Selection, rename, delete, visibility, and document-level undo/redo.

Existing single-mask edits become one region; imported masks attach to the selected
region. Editing display opacity must not change mask coverage or final blending.
Labels/icons supplement colour for accessibility. Empty masks and missing instructions
produce actionable validation messages.

Keep two representations separate:

1. Semantic coloured guide for the model, rendered from source plus coloured regions.
2. Local edit-coverage mask, derived from region geometry rather than guide RGB values.

Default overlapping pixels belong to the topmost enabled region for guide colour and
instruction assignment. The editable mask is the maximum coverage of enabled masks,
not a sum; overlap cannot become more opaque merely because two regions overlap.
Changing region order changes guide priority explicitly. Feather once at the final
coverage boundary; preserve zero-coverage pixels from the decoded source exactly.

Submission uses TWO generated references: clean prepared source and a combined guide.
Additional user references occupy the remaining eight slots. Compose one prompt naming
each enabled region's colour/label and its instruction, with source/guide tags resolved
by the registry. Never send region arrays, masks, or strength as unsupported API fields.
All guides count in reference count, decoded-pixel, payload, and VRAM estimates.

The worker generates a whole image. Browser compositing preserves pixels outside the
editable/feathered area; it cannot guarantee the model follows each region's instruction
or aligns every generated feature. Display BOTH the raw worker output and local
composite for each completed edit, with clearly labelled previews and independent
inspect/download actions. Do not hide raw output behind a composite-only result card.
Keep the original source available for comparison. Preserve the raw result even if
local compositing fails. Apply the same presentation to outpainting and to edit results
within series or parameter grids; match raw/composite pairs by stable result ID.

## 4. Outpainting in the same editor

Add an Extend mode with left/right/top/bottom expansion, target-ratio controls, anchor
position, optional seam blending, and preview of the final canvas and protected source.
Show local output dimensions separately from the legal worker generation dimensions.

Preparation:

1. Place the oriented source at a known integer offset on the expanded canvas.
2. Build the editable mask from newly exposed space; optionally extend a bounded seam
   band into the original. Preserve-original mode is the default with no inward band.
3. Build clean/annotated references and an explicit continuation instruction. Boundary
   markers/fill are model guidance, not a native outpainting input.
4. Map the expanded canvas into legal worker dimensions, preserving aspect by fitting
   and recording padding rather than stretching the original.
5. Map the generated result back, composite through the edit mask, and copy protected
   source pixels back. Allow coloured edit regions inside the source in the same pass.

Start with a single generation pass. Do not introduce tiled multi-job outpainting in
this release. If a large workspace needs downsampling, show the effective detail loss
before submission. Cap the expanded workspace at a conservative browser pixel/memory
budget (initially at most 20 million pixels, reduced if allocation fails); independently
enforce worker output and reference limits. PNG exports of local composites can be
larger than the worker's inline cap because they are created after transport.

## 5. Sketch references: explanation and scope

A sketch reference is a drawing of what should appear or where objects should be,
submitted as an ordinary reference. Inpainting marks WHERE existing pixels may change.
They can be combined, but their meanings differ. A rough drawing is soft visual
guidance, not ControlNet or guaranteed pose conditioning. Do not add a separate sketch
workspace in this scope; keep drawing/rendering primitives reusable for a later tool.

## 6. Finite repeated generation, without a general queue

Add Total images and Images per request (1 or 4), plus a Run series button and summary.
Use a conservative configurable maximum (initially 100 total images). A final partial
request uses the actual remainder, always within the API's 1–4 range.

Example for 20 outputs and starting seed 100:

| Request | num_images | seed | Expected image seeds |
| --- | --- | --- | --- |
| 1 | 4 | 100 | 100–103 |
| 2 | 4 | 104 | 104–107 |
| 3 | 4 | 108 | 108–111 |
| 4 | 4 | 112 | 112–115 |
| 5 | 4 | 116 | 116–119 |

The 1-image mode uses 20 requests with seeds 100 through 119. Resolve seed -1 to ONE
explicit random base seed before planning. Use BigInt and existing lossless JSON;
wrap at MAX_SEED + 1 exactly as the worker does. Show wrapped ranges clearly.

Plan and freeze all inputs before starting; changing the editor affects the next run.
Run one request at a time, waiting for terminal success and result processing before
submitting the next. Keep each request below 10,000,000 serialized bytes; all images
within one response still share the existing worker output budget. Four requested
images do not force physical parallel generation; preserve estimator route guidance.

Runner states: ready, submitting, following, processing, paused-after-current,
stopped, failed, submission-uncertain, completed. Display total image count, request
count, actual completed outputs, failed/pending seed ranges, endpoint/job IDs, and
elapsed time. Progress is counts/status, not invented diffusion-step percentages.

Controls:

- Stop after current prevents future submissions while collecting the current result.
- Cancel current and stop uses existing RunPod cancellation, acknowledges races, and
  retains a result if the job completed before cancellation took effect.
- Read-only poll failures can be retried with bounded backoff for transient failures.
- Never retry a POST automatically. Submission timeouts/invalid responses freeze the
  runner as uncertain because work may already be paid for and running remotely.
- Default stop on worker/job failure. Explicit retry must display the request/seeds
  and duplicate-generation consequence; never silently change batch size or quality.
- Leaving/reloading ends local dispatch. A known current job can be manually resumed
  through the existing job-ID flow. No hidden background/server-side runner.

All results accumulate in an in-memory run collection, independent of optional history.
Keep compressed Blobs, thumbnails, and metadata; release full-resolution decoded
bitmaps after use. Show browser memory limitations without promising unlimited runs.

## 7. Parameter comparison grids

A grid generates the SAME scene/settings with selected parameters changed, labels
each result, and lets the user inspect or reuse the settings they prefer.

Example: rows CFG [1, 2, 3], columns Steps [20, 40, 60], fixed seed 100. This is nine
images/nine distinct configurations. Another grid can use seed on one axis. Keep the
initial selectable axes to CFG, steps, and seed; dimensions and unrelated settings stay
fixed. Normal UI CFG remains 1–4. Negative prompts are omitted at CFG 1 and disclosed
as active only above 1, so a comparison cannot accidentally hide that difference.

Allow one-axis strips or two-axis grids, with an initial 64-cell limit. Show the full
plan and number of remote requests before starting; the Start button runs that plan.
Use the series runner, but only group adjacent cells if ALL non-seed request settings
match and seeds are consecutive. Otherwise submit one image per cell. Different CFG
or step values cannot be placed in one `num_images: 4` request. Single-image requests
are the default for controlled comparisons because physical batching can affect output.

Persist exact cell-to-job/result mapping in the run model, never rely on arrival order.
Failed/cancelled cells remain labelled; do not shift later results into their positions.
For non-seed axes reuse the same explicit seed; seed-axis values are explicit. Fixed
seeds improve comparability but are not a promise of cross-batch bit-identical outputs.

Grid cards show axis values and seed; click to inspect, select winners, reuse settings,
or export a contact sheet. Do not add arbitrary queued experiments or editing a running
plan. Retrying failed cells is an explicit later action, not an automatic cost.

## 8. Better result inspection

Build one viewer shared by individual outputs, series, and comparison grids:

- Fit, actual 100% image pixels, bounded wheel/pinch zoom, pan, fullscreen, keyboard
  navigation, and accessible focus/close behavior. Respect reduced-motion preferences.
- Raw, local composite, and source selectors with correct dimensions and provenance.
  The result overview visibly presents raw and composite previews together; selectors
  in the inspector supplement those previews rather than being the only access to raw.
- Before/after slider and synchronized side-by-side view in matching coordinates.
  In outpainting, place the source at its expanded-canvas offset; mark unavailable
  source areas. Do not misleadingly stretch different-sized images to match.
- Optional RGB/alpha difference views; raw-versus-source differences use the recorded
  edit transform or explain that comparison is unavailable if no mapping exists.
- Checkerboard, light, dark, custom background, alpha-only view, and actual alpha
  presence indicator. A checkerboard drawn inside RGB pixels is not transparency.
- Seed, job ID, requested settings, actual MIME/bytes, raw/composite dimensions, and
  series/grid location. Viewer changes never modify the original image or worker input.
- Lazy bitmap decoding and explicit cleanup on navigation/close; cancel stale work.

## 9. Export preparation

Add an Export dialog for one or selected outputs. Choose raw/composite, PNG/WebP/JPEG,
quality where applicable, optional dimensions, transparent-margin trim, and filename.
Preserve untouched original download as a separate action.

- PNG preserves browser working pixels; no misleading lossy quality slider.
- WebP is offered only if the browser actually encodes it; inspect Blob.type instead
  of assuming Canvas honors the requested MIME. Native quality-driven WebP may be
  lossy; do not label it lossless without a dedicated verified encoder.
- JPEG requires explicit background flattening when alpha exists; choose its colour.
  PNG/WebP preserve alpha; test decoded alpha coverage for supported browser paths.
- Preview the ACTUAL encoded Blob and byte count. Bounded target-size search tries
  quality candidates from source pixels, keeps the best fitting candidate, and reports
  when the requested target cannot fit. Resize only when explicitly enabled.
- Limit output dimensions/pixels and peak simultaneous work before allocation.
- Empty fully transparent images have a defined trim result and cannot create a
  zero-sized canvas. Record trim/resize transformations as derivative metadata.
- ZIP selected images with sanitized unique filenames and optional JSON manifest of
  seeds/settings/job IDs. Exclude API keys and reference base64; this is not a project
  archive. Lazy-load a small maintained ZIP implementation and encode one image at a
  time. Cap selected export size; explain that Blob-based ZIP creation is memory-bound.
- Export comparison/series contact sheets with readable labels and bounded dimensions.

These operations compress successfully received/local images only. They cannot rescue
a worker result rejected by its unchanged ~8 MB inline output cap.

## 10. Worker/API invariants for every feature

- Only existing allowlisted input fields; no aliases, region objects, outpaint settings,
  series counts, comparison axes, masks, or strength fields in network requests.
- num_images 1–4; at most ten references INCLUDING generated guides; existing decoded
  reference limits; legal multiples-of-32 dimensions and <=4,500,000 output pixels.
- Existing reference resolution, transparency/format and CFG/negative prompt rules.
- Exact UTF-8 payload <=10,000,000 bytes after guide generation and prompt compilation.
- Frozen worker output-size and routing behavior remain authoritative. No automatic
  resubmission to overcome OOM/output overflow and no promise that a four-image job fits.
- No live VRAM claim: profiles and bars remain local estimates, recalculated for actual
  submitted references/settings and each grid configuration as needed.
- Preserve 64-bit seeds throughout planning, UI, requests, metadata and exports.

## 11. Implementation sequence and acceptance gates

1. State/execution seams: inject repositories and result processors into JobManager;
   extract request compiler, asset lifecycle, and immutable run snapshots. Verify the
   existing generation/inpaint path still behaves identically under the frozen API.
2. References: richer insertion and stable bindings, including inpaint guide offsets,
   alias rename, reorder, deletion, duplicate aliases and mode/source changes.
3. Combined edit document: single-mask compatibility, coloured regions/instructions,
   shared source/guide preparation, union compositing, transforms and undo/redo.
4. Outpainting: expanded coordinates, protected pixels, seam option, bounds validation,
   raw/composite inspection metadata, and combined inner edits.
5. Series runner: exact seed planning, one/four-image grouping, result accumulation,
   stop/cancel/error/uncertain-submission handling; then connect comparison grids.
6. Shared inspection viewer and derivative export preparation, ZIP/contact sheets.
7. Integration, documentation, production build, existing Nginx/container smoke checks,
   and updated downloadable release. Do not change the original planning document to
   claim these features exist before they are implemented.

Meaningful automated checks:

- Compiler contract snapshots assert no new worker fields, correct reference indices,
  exact payload boundaries, legal dimensions and lossless seed values.
- Editor pixel fixtures cover alpha, region overlaps, feather boundaries, protected
  pixels, crop transforms, outpaint offsets and mixed inpaint/outpaint documents.
- Mock RunPod series tests cover 20/4, 20/1, remainders, seed wrap, seed -1 resolution,
  no duplicate submissions, worker output.error, polling failures, uncertain POSTs,
  stop/cancel races, immutable snapshots and all results surviving history limits.
- Grid tests verify fixed seeds, axis mapping, legal grouping, CFG=1 handling, labels
  for missing cells and exact cell-to-output association.
- Browser tests exercise insertion/autocomplete, annotation undo, outpaint composition,
  series progress, grids, viewer transforms, alpha export, unsupported WebP fallback,
  MIME/extensions, target-size failure and ZIP member names/metadata.
- Run existing unit/browser checks and production build; rerun packaging checks when
  packaging/proxy behavior changes. Mock tests do not establish generative fidelity.

Live region-following and outpainting seam quality remain endpoint evaluation work.
No paid inference is necessary to implement or validate request/compositing correctness.
