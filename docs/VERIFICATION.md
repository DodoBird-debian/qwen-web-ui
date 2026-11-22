# Verification record

## 21 November 2026

The documentation audit used WebUI `a331cf5`, current worker `09d4b54`, and frozen worker `99c28f5`. Dependencies, Git internals and generated output were outside the 32-file inventory.

| Check | Result |
| --- | --- |
| WebUI | Production build, 106 unit tests and 72 Chromium tests passed. The browser tests use fixture responses and touch emulation. Safari and physical devices remain unverified. |
| LXC | 20 packaging tests passed. The deployed release served the current and previous asset hashes over HTTPS with its existing certificate, cleaned its upload workspace, and returned HTTP 200 from both RunPod health routes. |
| Worker CPU | 134 tests passed on the current worker and 78 on the frozen worker. Inference is simulated in these tests. |
| Compatibility | Seven browser calls passed against each worker using the real request parser, handler and encoder with deterministic pixels. The frozen worker rejected the oversized fixture. The current worker resized it and the WebUI showed its warning. The first current-worker attempt hit the five-second assertion timeout during a concurrent Chromium run. The repeat passed with a longer window. |
| VRAM matrix | CPU generation wrote all 48 cases to CSV, JSON and Markdown in a disposable directory, and benchmark listing returned 48. The generated results contain zero measured GPU peaks. |

The hosted health checks confirm reachability. Successful GPU generation, phase VRAM, quality, and cloud cancellation timing and billing remain unverified. [Regression cases and commands](#regression-coverage) · [Inference and delivery](inference-and-delivery.md)

### Documentation consolidation

| Original documents | Location after consolidation |
| --- | --- |
| WebUI architecture plan and browser editing plan | Usage and deferred features are in the README. Both full original plans remain linked at the audited WebUI commit. |
| Three November bug reviews, the coverage report and the result retention audit | Verified fixes and the original reproduction links are in the [regression coverage](#regression-coverage). |
| Frozen API and inference report, VRAM audit, and the open work in the retention audit | The unresolved RunPod 409, estimator examples and unimplemented work are in [inference and delivery](inference-and-delivery.md). |
| WebUI resource and mobile audit | Its compute, resource, mobile and module notes are in [this verification record](#resource-recovery-and-mobile-checks-in-121). |
| Worker frozen API proposal, fix record and optimization review | Design decisions, frozen verification and the optimization baseline share the [worker risk review](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/main/docs/RUNPOD_RISK_REVIEW.md). It links to the full originals. |

The initial copy with only the two unreferenced WebUI files removed still built and passed 106 unit tests and 20 LXC packaging tests. The upload plan dropped from 137 to 135 files. After consolidation, it dropped to 129 files, and the build, unit tests and packaging tests passed again. The worker's matrix generator still links to the maintained risk and measurement documents. The eight Markdown files in the frozen snapshot remain part of the reproducible archive at `99c28f5`.

The cleanup workstation's WebUI checkout also retains a byte-for-byte copy of the standalone audit as a local Git note on `a331cf5`. From that checkout, show it with `git notes --ref=documentation-audit show a331cf5`.

## Unreleased UI usability changes — 2026-10-19

- TypeScript checking and the production Vite build pass.
- All **94 unit tests** and **47 Chromium Playwright scenarios** pass.
- New browser coverage verifies empty Inpaint/Outpaint paste-to-source routing,
  subsequent reference pastes, source selection from references/recent results,
  source drops, consolidated run controls, explicit negative-prompt activation,
  Generate submission guards and focused region-instruction commits.
- Editor checks cover native text undo, mask undo/redo focus, zoom-scaled brush
  outlines, painting coordinates after zoom, temporary Space-drag pan, and
  shortcut suppression inside dialogs and during IME composition.
- Existing `#validation` and `#generation-activity` checks pass. The validation
  selector is preserved in the composer; active/unresolved activity is sticky
  and terminal activity remains visible in normal flow.
- Preview tests cover automatic export/reference encoding, immediate Apply
  invalidation, latest-settings publication, serialized native encodes, stale
  resource disposal, closing during encoding and recovery from invalid settings.
- Desktop and phone screenshots were inspected; responsive checks cover the
  desktop editor split, stacked controls and active mobile section navigation.
  These checks use Chromium emulation, not physical devices or Safari.
- Browser requests use mocked responses. No live inference or paid jobs were
  submitted. Changes are confined to this WebUI; API/transport and generation
  modules remain unchanged.

Verification used the repository's TypeScript, Vite, Vitest and Playwright
entry points through the available bundled Node runtime. Playwright uses
`CHROMIUM_PATH`, system Chromium when available, or its installed Chromium.

## Previous release record

Latest UI release: **1.2.1**. Verified locally on 2026-10-18.
Worker reference commit: `99c28f5d8a7fe0a5fa489ef4d619b1453198fccb`.

- Production TypeScript/Vite build passes. Inspector, export and ZIP tools are
  separate lazy-loaded chunks; production still runs Nginx only.
- 75 unit tests cover the original worker-memory parity fixtures and frozen
  contract, exact serialized request budgets, lossless 64-bit seeds, region mask
  union, outpaint coverage, alpha composition, alias resolution, series/grid
  planning, matching planned/dispatched byte counts, cancellation races,
  uncertain submissions, manual result reconciliation, export limits and ZIPs.
- 24 Chromium integration scenarios cover the existing calculator/generation
  flows plus session-only storage, opt-in persistence, aliases/roles/tag offsets,
  multi-region inpainting, simultaneously visible raw/composite results,
  protected outpaint pixels, mapped inspection, 20 outputs in both 4/request and
  1/request modes, fixed-seed grids, contact sheets/ZIPs, stopping dispatch,
  WebP transparency, JPEG flattening, and impossible export targets.
- The Docker image uses locked dependencies and pinned base digests. Real Nginx
  runs non-root with a read-only filesystem and temporary state. The local TLS
  fixture checks allowlisted routes/methods, authorization conversion, exact
  10,000,000-byte request hash and 413 rejection above the cap. All compiled lazy
  assets must be served with their original bytes and JavaScript MIME type.
- The packaging browser smoke test exercises outpainting, paired raw/composite
  previews, mapped inspection, WebP export and ZIP downloads under production CSP.
- Added audit regressions verify pause/reload/uncertain submission guards, expired
  IDs, stable result nodes/URLs, coalesced preparation, metadata-only guide reuse,
  feather inheritance, cancelled compression work, and IndexedDB history migration.
- Chromium touch scenarios verify 360/390px portrait and 844px landscape layouts,
  second-finger isolation, navigation, generation and result inspection. Physical
  devices and Safari were not tested.
- Native LXC installer and Nginx startup scripts pass shell syntax checks.
- Dependency audit reports zero vulnerabilities with fflate 0.8.3.
- The worker Git working tree is clean and its commit remains unchanged.

No live RunPod inference or paid jobs were submitted. Generative instruction
compliance, outpainting seam quality, real GPU memory accuracy and real Proxmox
installation are not established by mocked/browser/container tests.

`studio.png` is captured from the production Nginx container. Other feature
screenshots use mocked solid-colour outputs to demonstrate local preservation
and UI behavior; they are not examples of Qwen inference quality.

Commands are documented in README.md. Browser checks use the repository's
Playwright configuration; packaging checks use `python tests/packaging/nginx_smoke.py`.

## Resource, recovery, and mobile checks in 1.2.1

### Compute and recovery

| Finding | Fix |
| --- | --- |
| Pausing polling re-enabled generation while the accepted remote job continued. | A separate submission guard owns the unresolved endpoint/job identity. Generation stays blocked until a terminal result is checked. Pausing only stops reads. |
| A lost submission response could be followed by an accidental repeat, including after reload. | Reserve before POST, never retry POST, retain an uncertain marker in tab session storage. Known jobs resume by ID; unknown submissions require checking RunPod and explicitly clearing the marker. No automatic redispatch follows recovery. |
| Slow persistence delayed publishing the accepted job ID. | Publish identity immediately, before saving browser history. Save failures keep the accepted ID and remote guard. |
| Invalid status responses could poll indefinitely. | Validate response ID/status before updating; stop malformed responses. Retry only bounded transient status-read failures. |
| Expired jobs could leave recovery stuck. | A definitive status 404 marks the local record expired and releases its guard. Network failures retain the guard. |
| Reconciliation could erase a seed-validation failure. | Preserve terminal runner errors; reconciliation of interrupted known jobs never dispatches remaining requests. |

The guard is per tab, and holds only endpoint, optional job ID and time. It contains
no API key, prompt, image or preset. It is removed after resolution. If browser
storage is disabled, the in-memory guard works for the current page only. Closing
the tab ends local automation; an accepted remote job may continue. Other tabs and
other clients have their own execution state.

### Browser resources

- Result updates reuse unchanged cards, image elements and Blob URLs. Completed
  images are not recreated and decoded every time another series cell changes.
  Replaced/removed cards revoke their own URLs. Export selection and variant survive updates.
- Edit preparation has a dedicated serialized cache. Only the latest queued pixel
  revision runs; obsolete queued preparations are skipped. Metadata-only region
  edits share immutable alpha snapshots and reuse prepared guides. Clearing a
  region feather override correctly invalidates pixel preparation.
- Brush strokes no longer allocate a second full alpha buffer for shape previews;
  rectangles and ellipses still retain the required starting mask. Region exports
  encode sequentially rather than launching every canvas encoder together.
- Local compositing uses 128-row scratch canvases and pixel arrays instead of two
  extra full-size canvases and multiple full-image RGBA arrays. It yields between
  groups of rows and closes all acquired bitmaps, including after partial failure.
  Source pixels outside the union mask remain protected; raw output remains available.
- Intermediate guide/expansion canvases release their backing stores after encoding.
  Partial reference acquisition failures revoke already-created object URLs.
- Export option changes/closing abort obsolete compression ladders between native
  encodes. A descending ladder stops at the highest tested fitting candidate.
  A shared action lock prevents repeated clicks from starting the same local tool concurrently.
- History trimming reads small session summaries and IndexedDB index keys, without
  loading/cloning every result and base64 input. IndexedDB v3 upgrades existing v1 and v2 history in place. History browsing
  reads summaries and loads selected results by ID. Active jobs remain available
  when completed-history limits apply.
- Returned image headers, dimensions, image count and encoded size are checked
  before pixel decoding. Completed stored results are displayed without refetching
  and recompositing them.

Native canvas encodes already in progress cannot be cancelled. The current encode
finishes, then cancellation prevents the remaining work. Large sources, decoded
inspection canvases, retained results and ZIPs still require browser memory; the
existing pixel/file/run bounds continue to apply.

### Phone usability

- Bottom navigation jumps directly to workspace, references and settings.
- Text-entry fields use 16px type on phones, including landscape touch layouts,
  to avoid iOS focus zoom. Buttons and primary controls have at least 44px height.
- Narrow references, controls, toolbars, dialogs and result pairs wrap. Saved
  projects remain reachable. Bottom navigation respects the safe-area inset.
- The editing canvas has its own layout space and no longer collapses between
  tool panels on desktop. Touch painting owns one pointer; a second finger cannot
  add an unrelated stroke. Pan uses actual touch positions. The stroke's tool is
  frozen until release; document-changing toolbar actions ignore touches during an active stroke.

Automated phone checks use Chromium touch emulation at 360px/390px portrait widths
and an 844px landscape width. Physical iPhone/Android devices and Safari were not
available for this audit. A [phone inspector screenshot](phone-inspector.png) is included. The transport no longer requires AbortSignal.any/timeout,
which improves compatibility with older mobile browsers.

### Extension boundaries

- `generation/submission-guard.ts`: remote submission ownership and reload marker.
- `generation/runner.ts` and `plan.ts`: finite execution and immutable API requests.
- `resources/edit-preparation.ts`: preparation scheduling, invalidation and cleanup.
- `editor/`: mask documents, geometric preparation and local compositing.
- `components/results.ts`: incremental card and object-URL ownership.
- `components/mobile-navigation.ts` and `styles/mobile.css`: phone navigation/layout.
- `export/`: browser encoding, cancellation and export tools.
- `state/repository.ts` and `storage/`: summaries, session data and optional disk storage.
- `domain/workspace.ts`: existing versioned workspace descriptor for future presets.

New presets/features can build on those modules without changing the worker,
transport or deployment runtime. `app.ts` remains the integration layer; feature
logic should continue moving into these modules as new features are introduced.

The [original 1.2.1 audit](https://github.com/DodoBird-debian/qwen-web-ui/blob/a331cf51388069b7929faa30ac56231c74619d31/docs/WEBUI-AUDIT.md) records the baseline. See [current regression coverage](#regression-coverage) for the additional recovery and storage regressions.

## Regression coverage

The WebUI and worker fixes below map to repeatable checks. The archived-worker compatibility test uses the parser, handler, and image encoder from `99c28f5` with deterministic fixture pixels. It exercises the current WebUI through the existing health, submit, and status routes.

### November bug reviews

| Finding | Fix and regression coverage |
| --- | --- |
| Re-enabling browser storage overwrote a newer project | The migration checks the saved revision timestamp in the write transaction. A two-tab test keeps the newer prompt and carries session-only work to disk. [Browser bug regressions](../tests/browser/bug-review.spec.ts) |
| Failed LXC activation rolled back a newer release | The activation lock covers snapshots, switching, validation, restart, health checks, and rollback. The concurrent test stages a failure and a successful activation, then checks the active release. [Deployment regressions](../tests/packaging/test_lxc_deploy.py) |
| Text-only import retained an older canvas | Import unloads the editor and resets the outpaint toggle. A project saved after import has the new prompt and no old canvas, mask, or regions. [Browser bug regressions](../tests/browser/bug-review.spec.ts) |
| One-sided outpainting blended untouched edges | The seam uses the distance to edges with an extension. Unit cases check each side independently. [Editor tests](../tests/unit/tools.test.ts) |
| Recovery showed an unrelated earlier series | Recovery clears the series view when the resumed job belongs to another run. Browser coverage compares the displayed result with the ZIP manifest. A runner test still covers reconciling a member of the original run. [Browser bug regressions](../tests/browser/bug-review.spec.ts) · [Runner tests](../tests/unit/generation.test.ts) |
| The inspector rejected a resized worker image | The raw inspector and compositor share proportional-result validation and coordinate scaling. Chromium checks the aligned raw pixels against the composite and opens the difference view. [Browser bug regressions](../tests/browser/bug-review.spec.ts) |
| The first Generate click after a series count edit was lost | Planner fields refresh on input. A Chromium test keeps the count field focused and verifies that the first click submits the edited count. It also verifies that an invalid count blocks submission. [Browser bug regressions](../tests/browser/bug-review.spec.ts) |
| The Python client accepted truncated PNGs and hid nested errors | The client verifies and decodes each frame, then retains valid frames at their original indices. Tests cover corrupt-only and mixed responses, nested errors, top-level errors, and an empty response. See the worker's `tests/test_transport.py`. |
| A slow source read could replace a newer edit | The editor reserves the load version before reading the file. Chromium releases a delayed first read after loading and painting the second source. [Browser bug regressions](../tests/browser/bug-review.spec.ts) |
| A pending mask import could write to the wrong region | The importer captures the original mask before reading the file and applies it while that mask still belongs to the current source. Chromium switches regions while the read is held. [Browser bug regressions](../tests/browser/bug-review.spec.ts) |
| Changing modes broke inpaint region tags | Region instructions retain the two reserved source and guide positions independently of the selected mode. Chromium verifies the instruction, enabled Generate button, and request preview after the round trip. [Browser bug regressions](../tests/browser/bug-review.spec.ts) |
| Export JSON silently omitted the active comparison override | Single-request exports use the prepared request. For longer plans, the export dialog offers each prepared request as its own importable JSON file. Chromium compares the single-cell download with the actual outgoing body. [Browser bug regressions](../tests/browser/bug-review.spec.ts) |
| An empty saved key retained the old override | An empty field on a server-authenticated endpoint uses the server default. The browser test observes the header for the default and for an explicit replacement key. [Browser bug regressions](../tests/browser/bug-review.spec.ts) |
| The benchmark could mislabel a checkpoint | The harness resolves and verifies the Base revision before loading weights or recording the resolved revision. CPU fixtures cover the pin, a different revision, and an unversioned path. See the worker's `tests/test_runtime.py`. |
| A custom matrix output directory overwrote the checked-in report | An explicit directory receives JSON, CSV, and Markdown. A disposable checkout test preserves the existing report and checks all three artifacts. See the worker's `tests/test_vram.py`. |
| Reference usage and Find uses missed aliases | Both controls resolve unique aliases and retain source text offsets. Chromium verifies the use count, selected alias text, and compiled request. [Browser bug regressions](../tests/browser/bug-review.spec.ts) |
| Leading zeroes disabled generation | Seed text is normalized before the payload meter serializes it. Chromium observes numeric seed 41 after entering `0041`. [Browser bug regressions](../tests/browser/bug-review.spec.ts) |

### Recovery, delivery, and deployment fixes

| Finding | Regression coverage |
| --- | --- |
| Saved recovery overwrote results or lost an inpaint snapshot | Completed local jobs open without polling. A second test polls an unfinished edit after reload and verifies that the original mask produces a composite. [Browser bug regressions](../tests/browser/bug-review.spec.ts) |
| Import inherited a series plan and projects shared a canvas | Importing one image resets the planner and submits one image. Opening a text project after an inpaint project leaves the text project's editor data empty. [Browser bug regressions](../tests/browser/bug-review.spec.ts) |
| Redeploy broke export assets in an open tab or reused the old HTTPS identity | Tests check the previous assets route and both releases' files, certificate reuse on the same address, and certificate replacement after an address change. [Deployment regressions](../tests/packaging/test_lxc_deploy.py) |
| Worker Hub tests mislabeled explicit snapshots | CPU tests check exact and named revisions, model mismatches, and an unpacked snapshot with an unknown revision. See the worker's `tests/test_model_selection.py` and `tests/test_runtime.py`. |
| Failed passes, corrupt frames, and output fitting could lose usable results | In the four-image worker fixture, a failure on the third pass preserves seeds 42 and 43 and requests a refresh. Encoding retains originals where they fit and warns about resizing, quality, JPEG fallback, alpha flattening, or omissions. Browser and CLI preserve valid frames at their original response indices, and the browser retains them after reload. [Browser bug regressions](../tests/browser/bug-review.spec.ts) · [Image history tests](../tests/browser/history.spec.ts) |
| ZIP metadata and seed reuse lost image or edit information | ZIP records actual variant, MIME type, bytes, known dimensions, and delivery warnings. Export and contact-sheet actions capture the selection before lazy loading. Reuse keeps references, mask, and transforms when the input matches the saved edit. Chromium checks actual ZIP metadata and preserved pixels for cropped inpaint and outpaint after project reopen. [Browser tool tests](../tests/browser/tools.spec.ts) · [Browser bug regressions](../tests/browser/bug-review.spec.ts) |
| The synchronous worker blocked cancellation delivery | The serverless adapter runs inference in a thread and cooperatively stops at a denoising or pass checkpoint before releasing model hooks and caches. CPU tests verify cleanup and a successful following job. See the worker's `tests/test_cancellation.py` and `tests/test_runtime.py`. |
| History loaded all saved image payloads | IndexedDB v3 migrates jobs a record at a time, stores summaries and image frames separately, and deduplicates exact reference data. Startup reads summaries and fetches frames for at most 12 thumbnail jobs. The dialog renders 30 summaries per page, with full jobs loaded by ID. Chromium migrates a 32-job library, tracks reads, opens the oldest result, and reuses its reference. [Browser bug regressions](../tests/browser/bug-review.spec.ts) |
| Repeated LXC deployments accumulated build trees and releases | The deployer removes the invocation's upload directory after success or failure. Activation retains the active and preceding release and removes failed candidates. Temporary guest tests verify cleanup, retention, and rollback. [Deployment regressions](../tests/packaging/test_lxc_deploy.py) |
| The VRAM estimate conflated delivery limits and GPU placement | Browser and unit tests cover batching independently of response fit, editable offload, endpoint precedence, saved overrides, and placement parity. [Calculator tests](../tests/browser/calculator.spec.ts) · [Batching tests](../tests/unit/batching.test.ts) |
| Inference timing and the benchmark harness gave misleading results | Worker tests measure pipeline time separately from lock wait and encoding, check that the matrix uses the packaged Diffusers pin, and verify that only the benchmark scope relaxes the transport ceiling. See the worker's `tests/test_transport.py` and `tests/test_vram.py`. |
| The worker could admit invalid positional layouts, restart on bad input, omit benchmark inputs from the image, or fail before read-only cache fallback | The worker CPU tests cover both CFG branches, malformed image and Unicode handling, inline limits, the Docker ignore payload, and exact cache resolution and fallback. See `tests/test_fail_closed.py`, `tests/test_vram.py`, and `tests/test_runtime.py`. |

The pinned RunPod SDK keeps partial output when handling `refresh_worker` and translates the flag to `stopPod`. Its stop monitor cancels the task. The adapter waits for cleanup before propagating cancellation. An active GPU step or encode can finish before the worker reaches a checkpoint. Hosted cancellation timing and billing remain open. [SDK result handling](https://github.com/runpod/runpod-python/blob/v1.12.0/runpod/serverless/modules/rp_job.py#L220-L261) · [SDK stop handling](https://github.com/runpod/runpod-python/blob/v1.12.0/runpod/serverless/modules/rp_scale.py#L291-L335)

### Running the checks

Run these from the WebUI checkout with Node dependencies installed. The archived-worker check also needs Git, tar, uv, Chromium, and a sibling worker checkout containing the frozen commit. Pass a worker checkout path as the script's first argument to use a different location.

```sh
npm run build
npm test
npm run test:browser
python3 -m unittest discover -s tests/packaging
node tests/compat/frozen_api.mjs
```

From the worker checkout, run the CPU suite.

```sh
uv run --no-project --with Pillow==12.3.0 --with numpy==2.2.6 python -m unittest discover -s tests
```

The compatibility fixture covers authenticated requests, PNG with the maximum 63-bit seed, 4+1 WebP batch delivery with alpha and seed wrap, JPEG reference edits with CFG, local compositing from two legacy inpaint guides, and recovery after the archived inline-limit error. The tests run locally. GPU throughput, live RunPod generation, and deployment on the LXC require their respective environments. [Frozen compatibility test](../tests/compat/frozen_api.mjs)

### Original reproductions

The original reports include the reproduction steps, before-fix evidence, and dated test counts. [20 November review](https://github.com/DodoBird-debian/qwen-web-ui/blob/a331cf51388069b7929faa30ac56231c74619d31/docs/major-bug-review-astra62.md) · [21 November review](https://github.com/DodoBird-debian/qwen-web-ui/blob/a331cf51388069b7929faa30ac56231c74619d31/docs/bug-review-2026-11-21-astra62.md) · [21 November follow-up](https://github.com/DodoBird-debian/qwen-web-ui/blob/a331cf51388069b7929faa30ac56231c74619d31/docs/bug-review-follow-up-2026-11-21-astra62.md) · [Result retention review](https://github.com/DodoBird-debian/qwen-web-ui/blob/a331cf51388069b7929faa30ac56231c74619d31/docs/result-retention-audit.md)
