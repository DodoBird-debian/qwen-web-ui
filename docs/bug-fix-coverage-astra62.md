# Documented bug fixes and regression coverage

The WebUI and worker reviews record the original reproductions. This page maps the fixes to repeatable checks. The archived-worker compatibility test uses the parser, handler, and image encoder from `99c28f5` with deterministic fixture pixels. It exercises the current WebUI through the existing health, submit, and status routes.

## November bug reviews

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

## Earlier findings now fixed

| Finding | Regression coverage |
| --- | --- |
| Saved recovery overwrote results or lost an inpaint snapshot | Completed local jobs open without polling. A second test polls an unfinished edit after reload and verifies that the original mask produces a composite. [Browser bug regressions](../tests/browser/bug-review.spec.ts) |
| Import inherited a series plan and projects shared a canvas | Importing one image resets the planner and submits one image. Opening a text project after an inpaint project leaves the text project's editor data empty. [Browser bug regressions](../tests/browser/bug-review.spec.ts) |
| Redeploy broke export assets in an open tab or reused the old HTTPS identity | Tests check the previous assets route and both releases' files, certificate reuse on the same address, and certificate replacement after an address change. [Deployment regressions](../tests/packaging/test_lxc_deploy.py) |
| Worker Hub tests mislabeled explicit snapshots | CPU tests check exact and named revisions, model mismatches, and an unpacked snapshot with an unknown revision. See the worker's `tests/test_model_selection.py` and `tests/test_runtime.py`. |
| Failed passes, corrupt frames, and output fitting could lose usable results | Worker fixtures exercise a failing later pass, valid frames after a corrupt entry, preservation of originals, and fallback warnings. Browser tests verify partial delivery and durable history. [Browser bug regressions](../tests/browser/bug-review.spec.ts) · [Image history tests](../tests/browser/history.spec.ts) |
| ZIP metadata and seed reuse lost image or edit information | Chromium checks actual ZIP file metadata and verifies local composites for both cropped inpaint and outpaint after project reopen. [Browser tool tests](../tests/browser/tools.spec.ts) · [Browser bug regressions](../tests/browser/bug-review.spec.ts) |
| The synchronous worker blocked cancellation delivery | Worker tests cancel between passes or during a denoising step, verify cleanup, and run a following job. See the worker's `tests/test_cancellation.py` and `tests/test_runtime.py`. |
| History loaded all saved image payloads | IndexedDB v3 migrates jobs a record at a time, stores summaries and image frames separately, and deduplicates exact reference data. Startup reads summaries and fetches frames for at most 12 thumbnail jobs. The dialog renders 30 summaries per page, with full jobs loaded by ID. Chromium migrates a 32-job library, tracks reads, opens the oldest result, and reuses its reference. [Browser bug regressions](../tests/browser/bug-review.spec.ts) |
| Repeated LXC deployments accumulated build trees and releases | The deployer removes the invocation's upload directory after success or failure. Activation retains the active and preceding release and removes failed candidates. Temporary guest tests verify cleanup, retention, and rollback. [Deployment regressions](../tests/packaging/test_lxc_deploy.py) |
| The VRAM estimate conflated delivery limits and GPU placement | Browser and unit tests cover batching independently of response fit, editable offload, endpoint precedence, saved overrides, and placement parity. [Calculator tests](../tests/browser/calculator.spec.ts) · [Batching tests](../tests/unit/batching.test.ts) |
| Inference timing and the benchmark harness gave misleading results | Worker tests measure pipeline time separately from lock wait and encoding, check that the matrix uses the packaged Diffusers pin, and verify that only the benchmark scope relaxes the transport ceiling. See the worker's `tests/test_transport.py` and `tests/test_vram.py`. |
| The worker could admit invalid positional layouts, restart on bad input, omit benchmark inputs from the image, or fail before read-only cache fallback | The worker CPU tests cover both CFG branches, malformed image and Unicode handling, inline limits, the Docker ignore payload, and exact cache resolution and fallback. See `tests/test_fail_closed.py`, `tests/test_vram.py`, and `tests/test_runtime.py`. |

## Running the checks

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

The production build and 106 WebUI unit tests passed, along with 72 Chromium tests,
20 deployment tests, and 134 worker CPU tests. The archived worker handled seven
browser submissions in the compatibility check.
