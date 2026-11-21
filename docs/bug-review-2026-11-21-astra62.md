# Bug review, 21 November 2026

The fixes and regression tests are recorded in the coverage report. [Fix coverage](bug-fix-coverage-astra62.md)

Nine reproduced bugs were open when originally reported. The highest-priority failures can overwrite a newer project save or roll back a later successful LXC release.

The review used the WebUI working tree based on `5de1314` and the worker working tree based on `deedfce`, including local edits in both. Each finding below records the observed failure and a regression check for a future fix.

## Fixed · P1 · Enabling browser storage overwrites a newer project save

Save a project in tab A with browser storage enabled. Open it in tab B, change its prompt, and save. In tab A, turn browser storage off and on. Reading IndexedDB from B showed that A’s original prompt had replaced B’s newer one. Enabling persistence writes session records back to disk, including older copies of projects. [Storage synchronization](../src/storage/db.ts)

**Regression check.** Repeat with two tabs sharing a database. After A toggles storage and B reloads, B’s newer prompt should still be present. A project created solely in session storage should still migrate to disk.

## Fixed · P1 · A failed deployment rolls back a later successful release

Start with release O. Activate A and hold its health check open. Activate B against the same guest root and let it succeed. Then fail A’s health check. The active release went from B back to O because A restored the symlink and configuration it captured before activation. This was reproduced with temporary release directories and simulated service commands. [LXC activation and rollback](../deploy/lxc/activate.py)

**Regression check.** Exercise overlapping activations with distinguishable release content and settings. After the failed activation and the successful activation both finish, the active symlink, served files, and runtime configuration should all identify B.

## Fixed · P2 · Saving an imported text-only request retains the previous edit’s pixels

Complete an outpaint edit, import a JSON request containing only a text prompt, then save the project. The stored record had Generate mode and the imported prompt, plus the earlier source image, mask, and one region. Request import replaces the references and form values. Project capture also serializes any loaded editor. [Request import and project capture](../src/app.ts)

**Regression check.** Inspect the saved record after import and reopen it. The text-only project should contain the imported prompt and zero editor assets. A saved inpaint project should still reopen with its own source and masks.

## Fixed · P2 · One-sided outpainting blends pixels on untouched edges

Extend a 256 × 256 blue source by 32 pixels on the left, set the other three extensions to zero, and use an 8-pixel seam. With a solid red generated image, the composite’s right-edge pixel at (287, 128) and top-edge pixel at (160, 0) both changed from blue to RGBA (223, 0, 32, 255). The center stayed blue. The seam calculation includes the distance to all four original edges. [Expansion coverage](../src/editor/outpaint.ts)

**Regression check.** For each single-side extension, sample the original pixels near all four edges, away from corners. Only the edge adjoining the extension should blend when there are no painted regions.

## Fixed · P2 · Recovering an unrelated job leaves the previous series in the gallery

Finish a series with seeds 41 and 42, then use **Job history → Resume polling** to recover a different job returning seed 82. The status named the recovered job as completed, but the main gallery still showed seeds 41 and 42. Seed 82 was available through image history. The single-job gallery update is skipped while the previous series runner exists. [Job recovery and result display](../src/app.ts)

**Regression check.** After recovery, compare the job status, main gallery seeds, and selected ZIP contents. Each should refer to the recovered job. Separately verify that recovering a member of the original series still updates its matching cell.

## Fixed · P2 · The raw comparison inspector rejects a proportionally resized edit

Request a 256 × 256 edit and return a 128 × 128 raw image. The compositor accepted the proportional reduction and displayed the local composite. Choosing **Inspect raw → Before / after slider** produced “Raw result dimensions do not match the recorded edit transform.” The inspector requires exact dimensions where the compositor already accounts for delivery scaling. [Inspector alignment](../src/inspection/compare.ts) · [Composite mapping](../src/editor/inpaint.ts)

**Regression check.** Open the slider and difference views on a proportionally reduced raw image. Verify that a known pixel maps to the same source coordinate in both the inspector and the compositor.

## Fixed · P2 · The first Generate click after editing the series count is lost

Change the total in a series, leave the number field focused, and wait until Generate is enabled. In Chromium, the button received mouse-down. Blurring the number field fired a change event, which disabled Generate before the click completed. The first press sent zero requests. In a two-image series configured for one image per request, the second press submitted both jobs. [Planner events](../src/components/run-controls.ts) · [Request refresh](../src/app.ts)

**Regression check.** Edit the total, wait for a valid plan, and click Generate once with a pointer. Count submissions and check their image counts against the final plan. Repeat with an invalid total and verify that it cannot start a job.

## Fixed · P2 · The worker CLI counts a truncated PNG as a successful download

Pass `scripts/client.py --decode` a response containing a 24-byte truncated PNG and a valid PNG, both with valid base64 and PNG MIME metadata. The CLI exited successfully, listed both files in `result.json`, and emitted no warning. Pillow could decode only the second file. The CLI’s frame check accepts nonempty decoded bytes without decoding the image. [Worker CLI image handling](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/deedfcec1b6e5056127837d4fac9a6a51b249619/scripts/client.py#L43-L55)

**Regression check.** In a mixed response, retain the valid frame at its original index, exclude the truncated frame from the success list, and report which frame failed. An all-corrupt response should fail.

## Fixed · P3 · The worker CLI discards the reason for a worker rejection

Pass `--decode` a RunPod response with status `COMPLETED` and `{"error":"Cannot fit requested reference size"}` inside `output`. The CLI raised “The response contains no generated images.” It checks for a top-level error, then looks for images before reading the error in the worker output. [Worker CLI response parsing](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/deedfcec1b6e5056127837d4fac9a6a51b249619/scripts/client.py#L34-L39)

**Regression check.** Verify that both a top-level RunPod error and a nested worker error surface their original messages. Keep the empty-image diagnostic for a completed response containing neither images nor an error.

## Verification scope

At review time, the production build, 102 WebUI unit tests, 59 Chromium tests, 18 deployment tests, 129 worker CPU tests, and the local Nginx browser smoke test passed. The nine failures above were observed in additional focused checks using disposable browser storage, a local RunPod fixture, a temporary guest filesystem, and CLI response files. Live deployment and GPU inference remain unverified by this review.
