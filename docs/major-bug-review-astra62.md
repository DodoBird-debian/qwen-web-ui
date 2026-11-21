# Major bug review — 20 November 2026

The fixes and regression tests are recorded in the coverage report. [Fix coverage](bug-fix-coverage-astra62.md)

The review found six bugs. The fixes below cover the original failure cases, with local verification for the WebUI, LXC deployer, and worker.

Nine additional bugs were reproduced on 21 November and have since been fixed. [Follow-up review](bug-review-2026-11-21-astra62.md)

## Fixes and regression coverage

| Finding | Fix | Regression check |
| --- | --- | --- |
| Job recovery overwrote saved results and inpaint data | Recovery looks up the endpoint and job ID in browser storage. Saved images open directly, and an unfinished job resumes with its original input and inpaint snapshot. An IndexedDB transaction protects stored images from later status-only writes. | Chromium opens a completed local image with zero status calls, ignores a late expiry write, and resumes a persisted edit with a local composite. |
| Import inherited a previous run plan | A successful import resets to one batch and clears the separate-jobs switch. The preview lists each planned request and identifies example seeds when the starting seed will be chosen at submission. | Chromium previews the two four-image requests, imports one image, and observes one POST for one image. |
| Projects shared hidden editor state | Opening a project unloads the previous canvas, masks, regions, and undo history. Save and open operations run separately, and each save captures the editor state before awaiting image encoding. | Chromium switches from an inpaint project to a text-only project and verifies the saved text project has no source, mask, or regions. |
| Redeploy broke export in an open tab | Automated LXC activation serves missing `/assets/` files from the immediately preceding release. The active release takes precedence, and other missing assets return HTTP 404. Keep the preceding release on disk for this fallback. | The deploy test checks the generated Nginx configuration. A local Nginx and Chromium run verified that an open tab could first open its export dialog after a switch between builds with different hashes. |
| HTTPS reused a certificate for a former LXC address | Before reuse, deployment verifies expiration, the configured host, the loopback IP, and the matching private key. A changed address triggers reissuance and the new self-signed certificate needs to be trusted on clients. | OpenSSL verifies the replacement for the new IP and loopback, and rejects it for the old IP. A same-address redeploy keeps the original key pair. |
| Worker Hub tests mislabelled explicit snapshots | Test provisioning and the downloader check the explicit path against the requested model variant and known revision. Named refs resolve through the local cache. An unpacked snapshot with an unverifiable revision is reported with a null revision and a log message. | CPU fixtures reject a Turbo path for Base and a mismatched revision, accept an exact path and ref, and check the metadata for an unpacked snapshot. |

The WebUI production build passed along with 102 unit tests, 56 Chromium tests, 18 deployment tests, and 124 worker CPU tests. The release-switch check used local Nginx 1.26.3 with a mocked queue. These checks ran locally without using a deployed LXC or GPU worker.

## Original findings

### Fixed · P1 · Resuming a job could overwrite its saved images and edit data

With browser storage enabled, two recovery actions construct a fresh record under an existing job ID. The manual history action starts with default inputs. Reload recovery rebuilds the record from the endpoint and ID in session storage. Polling then writes the whole record to IndexedDB. [Manual resume](https://github.com/DodoBird-debian/qwen-web-ui/blob/5de131490dc52ba2cf92cf850064155b04a5a5ec/src/components/history.ts#L24-L38) · [Reload recovery](https://github.com/DodoBird-debian/qwen-web-ui/blob/5de131490dc52ba2cf92cf850064155b04a5a5ec/src/app.ts#L1343-L1355) · [IndexedDB write](https://github.com/DodoBird-debian/qwen-web-ui/blob/5de131490dc52ba2cf92cf850064155b04a5a5ec/src/storage/indexeddb.ts#L28-L38)

- **Expired job.** Start with a completed local job containing a prompt and one image. Enter its ID in **Job history → Resume polling** and have the status endpoint return 404. After reloading, the stored record was `EXPIRED`, the prompt was empty, and its image count had fallen from one to zero. The local image was available before the status check. [Completed-record handling](https://github.com/DodoBird-debian/qwen-web-ui/blob/5de131490dc52ba2cf92cf850064155b04a5a5ec/src/api/jobs.ts#L102-L109) · [404 handling](https://github.com/DodoBird-debian/qwen-web-ui/blob/5de131490dc52ba2cf92cf850064155b04a5a5ec/src/api/jobs.ts#L223-L229)
- **Inpaint job in progress.** Start with a saved pending job containing its prompt, source, mask, and placement transform. Reload, select **Check server status**, and return one successful image from the worker. The saved record contained the raw result, an empty prompt, and no inpaint snapshot or local composite. That removes the information needed to reconstruct the edit from job history. [Composite creation and final save](https://github.com/DodoBird-debian/qwen-web-ui/blob/5de131490dc52ba2cf92cf850064155b04a5a5ec/src/api/jobs.ts#L197-L221)

Resolve the endpoint and job ID against local storage before polling. Show existing completed results directly. Create a placeholder only for an unknown ID, and keep locally saved images and edit data when recording a remote expiry.

### Fixed · P1 · Importing one image could submit an entire previous series

Select a series of eight images in batches of four. Import a JSON request with `num_images: 1` and seed `41`. **Preview API request** showed one image. Pressing **Run series** sent two requests to the local mock queue, each for four images, starting at seeds `41` and `45`. The series summary still showed eight. On a live endpoint this can incur charges for seven additional outputs.

Import restores the request fields while leaving the run planner active. The preview serializes the base request, while submission reads the separate series controls. Reset the planner to one batch on successful import. When a series or grid is selected deliberately, show the outgoing request count and bodies in its preview. [Request import](https://github.com/DodoBird-debian/qwen-web-ui/blob/5de131490dc52ba2cf92cf850064155b04a5a5ec/src/app.ts#L1162-L1172) · [Request preview](https://github.com/DodoBird-debian/qwen-web-ui/blob/5de131490dc52ba2cf92cf850064155b04a5a5ec/src/app.ts#L1191-L1219) · [Planner](https://github.com/DodoBird-debian/qwen-web-ui/blob/5de131490dc52ba2cf92cf850064155b04a5a5ec/src/components/run-controls.ts#L77-L90) · [Submission](https://github.com/DodoBird-debian/qwen-web-ui/blob/5de131490dc52ba2cf92cf850064155b04a5a5ec/src/app.ts#L997-L1022)

### Fixed · P2 · Saving a text-only project could copy another project’s source and mask

Open a saved inpaint project A. Then open a saved text-only project B and immediately save B. Before the save, B had no source, mask, or regions. Afterward its stored mode was still `generate`, but it contained A’s source image, a mask, and one region. The user can copy image data between projects without entering the editor or uploading a file.

Opening B leaves A’s loaded editor in memory when B has no source. Saving captures any loaded editor. Clear the previous editor state on project restore, including when the incoming project has no source. A regression test should reopen B after saving and verify its source, mask, and regions are still absent. [Project restore](https://github.com/DodoBird-debian/qwen-web-ui/blob/5de131490dc52ba2cf92cf850064155b04a5a5ec/src/app.ts#L1261-L1270) · [Project capture](https://github.com/DodoBird-debian/qwen-web-ui/blob/5de131490dc52ba2cf92cf850064155b04a5a5ec/src/app.ts#L1235-L1242)

### Fixed · P2 · An open tab could lose export after a successful redeploy

Open release A, generate an image, and leave **Export raw** unopened. Switch the active release to B with a change to the export dialog. The first click on **Export raw** in the original tab then returned HTTP 404 for A’s hashed dialog module. The dialog never opened, even though release A was still on disk. Reloading to get B can discard a session-only result.

The result view loads export code on first use. Nginx serves assets exclusively from the active release and returns 404 for a missing hash. Keep previous hashed assets addressable for a deployment grace period, and test an open tab’s first export across a release switch. The reproduction used two production builds, Chromium, and a loopback static server serving the same switched directory. [Dynamic export import](https://github.com/DodoBird-debian/qwen-web-ui/blob/5de131490dc52ba2cf92cf850064155b04a5a5ec/src/components/results.ts#L295-L302) · [Nginx root and asset lookup](https://github.com/DodoBird-debian/qwen-web-ui/blob/5de131490dc52ba2cf92cf850064155b04a5a5ec/nginx/server.conf#L4-L53) · [Release switch](https://github.com/DodoBird-debian/qwen-web-ui/blob/5de131490dc52ba2cf92cf850064155b04a5a5ec/deploy/lxc/activate.py#L220-L224)

### Fixed · P2 · Redeploying under a new LXC address could keep the old HTTPS certificate

Generate a certificate for `192.0.2.11`, then run certificate setup again in the same directory for `192.0.2.22`. On OpenSSL 3.5.7, the second call returned the identical certificate. A TLS client that trusted it connected successfully using the loopback identity but failed verification using the new IP. The deployment health check uses loopback, so it misses this client-facing failure.

The reuse check combines expiry and identity options in one OpenSSL invocation and trusts its exit status. Validate expiry, the key pair, and the expected DNS or IP subject alternative name independently. Include a changed-address case alongside same-host reuse. [Certificate reuse](https://github.com/DodoBird-debian/qwen-web-ui/blob/5de131490dc52ba2cf92cf850064155b04a5a5ec/deploy/lxc/activate.py#L64-L93) · [HTTPS health check](https://github.com/DodoBird-debian/qwen-web-ui/blob/5de131490dc52ba2cf92cf850064155b04a5a5ec/deploy/lxc/activate.py#L101-L113)

### Fixed · P2 · Worker Hub tests could identify a Turbo snapshot as Base

Under explicit Hub-test provisioning, select Base and its pinned revision while setting `MODEL_PATH` to a Turbo snapshot at a different revision. Using the worker’s CPU-only snapshot fixture, startup returned the requested Base model ID and revision paired with the actual Turbo directory. A test or benchmark can consequently attribute results to the wrong checkpoint. The ordinary production startup uses a separate model-detection path.

The explicit-path resolver checks the snapshot’s layout and returns it. Hub-test preparation keeps the requested model and revision, and the service copies those fields into results. Compare the selected variant and revision with the resolved snapshot before accepting a cache hit. Report an unverifiable revision explicitly for an unpacked snapshot. [Explicit path resolution](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/deedfcec1b6e5056127837d4fac9a6a51b249619/qwen_worker/runtime.py#L173-L182) · [Hub-test selection](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/deedfcec1b6e5056127837d4fac9a6a51b249619/qwen_worker/runtime.py#L339-L353) · [Output metadata](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/deedfcec1b6e5056127837d4fac9a6a51b249619/qwen_worker/service.py#L131-L136)

## Original verification

Reviewed the WebUI working tree based on `5de1314` and worker `deedfce`. Both recovery cases, the import, and the project save also reproduced on a clean copy of WebUI commit `5de1314`. Source links are pinned to those commits.

The focused checks used disposable browser storage, a mock RunPod queue, temporary release directories, local TLS handshakes, and fixture checkpoint metadata. Live LXC behavior and GPU inference were outside this verification.

| Existing check | Result |
| --- | --- |
| WebUI production build | Passed |
| WebUI unit tests | 102 passed |
| WebUI Chromium tests | 52 passed |
| LXC deployment tests | 16 passed |
| Worker CPU tests | 122 passed |
