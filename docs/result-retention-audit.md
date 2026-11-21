# Result retention and fidelity review

The fixes and regression tests are recorded in the coverage report. [Fix coverage](bug-fix-coverage-astra62.md)

This pass followed a result from request planning and reference preparation through worker admission, inference, response fitting, polling, browser history, and export. It also covered job recovery, worker model selection, the Python client, and LXC activation. The six earlier fixes are recorded in the [major bug review](major-bug-review-astra62.md).

## Fixed in this pass

| Finding | Change and evidence |
| --- | --- |
| A failed later sequential inference pass discarded earlier images | The worker keeps the earlier CPU images and returns partial output within the same JSON budget. A runtime failure still requests worker refresh after delivery. In a four-image CPU fixture, pass three failed and seeds 42 and 43 remained downloadable. The worker made three calls. A failure before any image is available still follows the normal error path. |
| A malformed image stopped both clients from reading later images | The browser validates each frame independently and preserves the response index in its result ID. The CLI skips invalid entries and writes their index and reason to `client_warnings` in `result.json`. Given valid, invalid, valid entries, both clients retained the first and third. Chromium also verified both images after an opt-in history reload. Duplicate seed labels can no longer collapse separate cards in the job view. |
| Response fitting could degrade images that already fit and conceal changes | Packing starts with original encodings, keeps originals where they fit, and includes warnings for reduced dimensions, quality, lossy WebP, JPEG fallback, flattened alpha, and omitted images. A mixed batch under a 32 KB fixture budget kept the small PNG and its alpha channel while fitting the noisy image as JPEG. A separate PNG fixture kept the full-size lightweight frame alongside a resized frame. |
| ZIP metadata described the requested settings without the exported file properties | ZIP entries now record the actual variant, MIME type, byte count, and dimensions where known, along with the job warning. ZIP and contact sheet actions capture selections before loading their export modules. The Chromium ZIP test checks actual dimensions and format in the manifest. |
| Seed reuse dropped the local inpaint composite | Reuse restores the prepared references and keeps the saved source, mask, transform, and outpaint placement in the next request. The WebUI applies the snapshot when the first two references and canvas dimensions match. It shows the selected endpoint if it differs from the saved job. Chromium verifies pixels inside and outside the edit for both modes, including outpaint after saving and reopening the project. |
| Synchronous inference delayed RunPod’s stop listener | The serverless adapter runs inference in a thread. When RunPod cancels the task, the adapter sets a per-job stop signal and waits for cleanup under the pipeline lock. The worker checks the signal after each denoising step and between generation passes. CPU tests verify that a cancellation skips remaining passes, releases model hooks and caches, and lets a following job use the pipeline after cleanup. |

Sender-side partial output depends on the worker reaching its response path. The pinned SDK retains the partial `output` and translates `refresh_worker` to `stopPod` in the same response. This was checked locally against the pinned function. [RunPod SDK 1.12.0 result handling](https://github.com/runpod/runpod-python/blob/v1.12.0/runpod/serverless/modules/rp_job.py#L220-L261)

RunPod's stop monitor calls `task.cancel()`. The worker propagates that cancellation after cleanup so the SDK can release its job slot. A stop takes effect at the next checkpoint, so an active GPU step or image-encoding operation may finish first. Live cancellation timing and billing behavior still need measurement. [SDK handler invocation](https://github.com/runpod/runpod-python/blob/v1.12.0/runpod/serverless/modules/rp_job.py#L220-L250) · [SDK stop handling](https://github.com/runpod/runpod-python/blob/v1.12.0/runpod/serverless/modules/rp_scale.py#L291-L335)

## Fixed in the follow-up

### Fixed · P2 · Browser startup can materialize an entire image library

Browser persistence keeps every successful job until deletion. Before the fix, startup and the history dialog used full-record reads, including request reference strings, result Blobs, and edit snapshots. Thumbnail rendering was limited to the latest 12 jobs while the history component retained the full records. In the worst case, 100 jobs with distinct references near the 10 MB request limit represent nearly 1 GB of encoded request data before browser overhead. This is a code-level bound. A browser crash at that size has not been measured.

IndexedDB v3 stores lightweight job summaries and deduplicates exact reference data. The history dialog shows 30 summaries per page and loads the full record by ID for view, reuse, and export. A 32-job Chromium fixture verifies migration and limits startup reads to summaries and the latest thumbnail frames. [IndexedDB reads](../src/storage/indexeddb.ts) · [History hydration](../src/components/image-history.ts) · [History dialog](../src/components/history.ts)

### Fixed · P2 · Frequent automated LXC deployments can exhaust the guest disk

Previously, each deployment created a unique source directory, installed its own `node_modules`, and copied build output into a separate release. Success and failure both left the source directory on disk. The checkout used for this review has 72 MB of dependencies, which indicates the scale of each retained install. Actual guest disk use depends on its environment.

Automated deployment removes its upload and build workspace after success or failure. Activation runs under a lock and retains the active and immediately preceding releases for rollback and open-tab assets. Temporary guest tests cover repeated, overlapping, and failed activations. [Upload](../deploy/lxc/deploy.py) · [Remote build](../deploy/lxc/remote-deploy.sh) · [Activation](../deploy/lxc/activate.py)

## Improvements to evaluate

1. **Offer exact-size downloads beyond the inline cap.** Store original outputs in private object storage keyed by job and seed. Return short-lived signed links plus inline previews, with explicit cleanup and expiry. Independently benchmark an alpha-preserving WebP fallback for transparent requests to measure how often it can avoid JPEG flattening.
2. **Resume a series as a collection.** Persist its plan, accepted job IDs, parameter labels, and completed cells. Rebuild the comparison grid after reload and let the user explicitly select missing cells for a new request. Existing per-job history can still recover downloaded frames individually.
3. **Stream large browser exports.** Move ZIP assembly off the UI thread and stream entries to disk where supported. Offer bounded split archives elsewhere. The current 100 MB cap still requires simultaneous allocations for selected images and the archive. [Archive assembly](../src/export/archive.ts)
4. **Measure fidelity and throughput on real Base and Turbo workers.** Compare original dimensions, alpha retention, retained image count, and p50/p95 inference and encoding time for single and multi-image requests. Include high-entropy transparent PNG inputs, 24 GB model offload, and a controlled cancellation. Use identical seeds, dimensions, and an explicit payload cap for comparisons.

## Verification

The production WebUI build passed, along with 102 WebUI unit tests, 59 Chromium tests, 18 deployment tests, and 129 worker CPU tests. A separate local check exercised the pinned SDK's `stop_job` and `run_job` functions with the new handler. It verified cancellation, cleanup, and a successful following job. GPU output, cloud cancellation timing, and guest disk growth remain to be measured on the deployed services.
