# Qwen Image Studio

Version **1.2.1** · standalone browser tools for the locked worker API.

A standalone web UI for the frozen Qwen-Image 2.1 RunPod worker. Production runs
**Nginx only**: static browser assets and an allowlisted RunPod HTTPS proxy. All
editing, estimates, projects and image preparation run in the browser.

## Docker

```sh
docker compose up -d --build
```

Open `http://YOUR_HOST:8080`, select **Connect RunPod**, and enter the existing
queue endpoint ID and API key. The key stays in tab memory and must be entered
again after reload. No GPU or worker files are needed on the UI host.

The runtime is non-root, supports a read-only filesystem and uses temporary
Nginx state in `/tmp`. Container health is `/healthz`; it does not call RunPod.
The build pins base image digests and npm dependencies. To use a managed build
proxy CA, pass `docker build --secret id=proxy_ca,src=/path/to/ca.pem ...`.

Edit `public/config.json` before building, or bind-mount it to
`/opt/qwen-image-studio/current/config.json` for non-secret endpoint/GPU defaults.
Use `NGINX_RESOLVERS` to override the container's IPv4 DNS servers if necessary.

## Proxmox LXC

For a fresh Debian 13 LXC, `./deploy.sh` uploads source over SSH, installs build
tools and Nginx, builds/tests, activates a release and restarts the web server.
Use the same command for updates. Ignored `.env` supplies RunPod defaults and
`.env.deploy` supplies the LXC login; the API key stays in root-readable server
configuration. See [automated LXC deployment](deploy/lxc/README.md).

Use native Nginx in an unprivileged Debian 12/13 guest. Build the static release
elsewhere; no Node, GPU passthrough or nested Docker is needed in the guest.
See [LXC installation, updates and rollback](deploy/lxc/README.md).

## Features

- All frozen worker request controls, native aspect presets, transparency and
  independent reference-processing resolution.
- Up to ten ordered references with `<imageN>` insertion, autocomplete, stable
  reorder behavior, previews, explicit resizing and compression. Aliases, reference roles,
  thumbnail/keyboard autocomplete with `@` or `<image`, and editable role instructions
  make prompt insertion easier. Optional `@{alias}` text resolves to a numbered tag;
  duplicate/missing aliases require repair before submission.
- Lossless 64-bit seeds in requests, returned results, JSON imports/exports and
  history. Random seeds and per-output wrap match the worker's integer range.
- Exact serialized UTF-8 request budgeting at **10,000,000 bytes**, including
  base64, JSON, prompts and generated mask guides. Nginx enforces the same limit.
- Phase-aware VRAM estimates with model-weight placement, CFG/KV effects,
  sequential/batch comparisons and endpoint-specific GPU profiles.
- Separate output-size guidance for the worker's **8,000,000-byte inline cap**.
- Combined coloured-region inpainting: brush/eraser/rectangle/ellipse, per-region
  instructions, visibility, ordering, undo/redo, mask import/export, crop context,
  global/per-region feathering and local compositing.
- Outpainting in the same editor: side expansion, target ratio/anchor, protected
  original pixels, optional inward seam blending, and simultaneous inner-region edits.
- Consecutive-seed series: 1–100 images, 1 or 4 per request, legal remainder batches,
  stop after current, explicit cancellation, and all outputs retained for the session.
- One/two-axis CFG/steps/seed comparison grids (up to 64 cells), fixed comparison
  seeds, labelled failed/pending cells, controlled single-image requests or legal grouping.
- Fullscreen result inspection, 100%/fit/zoom/pan, synchronized before/after slider
  and side-by-side views, RGB/alpha differences, and transparency backgrounds.
- Browser export preparation with real size/quality previews, PNG/WebP/JPEG,
  optional trimming/resizing, bounded target-size compression, selected-image ZIPs,
  and labelled contact sheets. Exports never replace the untouched raw output.
- Async RunPod jobs, status/error handling, explicit remote cancellation,
  resume by known/manual job ID, session projects/history and optional browser persistence.
- Both **raw worker output and local composite are visibly shown** for every edit,
  with independent inspection/download/export controls. Source comparison, metadata,
  seed reuse and sending results back to references/inpainting are available.

### Inpainting compatibility

The frozen worker has **no native mask or strength input**. This UI sends a
source image and combined coloured area guide as ordinary `images` references, with an editing
instruction. The source and guide use two reference slots and count toward
payload, decoded pixels and estimated VRAM. The returned generation is then
composited through the union of enabled region masks (maximum coverage, not added
opacity). Later regions own guide-colour overlaps; each region has an editable
instruction. One painted region may use the main prompt; multiple painted regions
require their own instructions. Region feather overrides inherit the global setting
when empty. Guide colours are never used to derive final compositing coverage. The raw worker image and local derivative
remain separately downloadable.

Pixels outside the editable/feathered area come from the oriented source canvas.
PNG composite exports preserve the decoded working pixels; this is not a claim
of original encoded-file identity or perfect generative edit alignment. Imported
masks use white for edit, black for preserve and gray for blending. Use matching
source dimensions. Crop mode letterboxes the context into the chosen legal output
dimensions and maps the generated crop back afterward.
Workers that compress oversized responses by proportionally resizing images are
supported: the compositor maps the returned dimensions back onto the edit canvas.

### Outpainting

Open **Outpaint**, load a source, and set side expansion or apply a target ratio and
anchor. The preview distinguishes final canvas dimensions from worker dimensions.
New areas are editable; the original is protected unless a painted region or explicit
inward seam band permits an edit. Raw worker output and the mapped local composite
are both displayed. This is single-pass reference-guided outpainting, not a new worker
mask input. Large workspaces can require generating detail at a smaller working scale.
Final canvases are limited to 20 million pixels / 16,384 per side; region masks are
limited to eight regions / 40 million mask pixels combined. Generative seam quality and
instruction compliance depend on the model. A standalone sketch editor is deferred.

### Repeated runs and comparisons

**Images & requests** is at the top of settings. Choose the 10-image shortcut for
three sequential requests of **4 + 4 + 2**; the worker API never receives more
than four images in one request. The 1/4/10/20 shortcuts, editable total, and
1–4 images/request selector build the same frozen plan. Click a planned request
to inspect its seeds and byte count without sending it. Current-run chips show
each request's state and jump to its results.

Select **Consecutive-seed series**, choose total images and 1/4 images per request,
and start. Twenty images starting at seed 100 use five four-image requests starting
at 100, 104, 108, 112, 116, or twenty single-image requests from 100 through 119.
Random mode resolves one explicit starting seed. Integer wrap matches the worker.
A final remainder uses one to three images. The worker chooses physical parallel or
sequential inference; four requested outputs still share one inline response budget.
Series/grid controls override the normal Images and Separate output jobs controls.

Comparison grids support CFG 1–4, steps 1–100, and explicit seeds. Non-seed axes
reuse one seed. CFG 1 omits negative prompts; above 1 enables them. Distinct CFG/step
values require distinct requests. Optional grouping only combines adjacent cells with
identical settings and consecutive seeds. The estimator shows the most demanding
planned request, including generated reference guides and the flat safety buffer.

Run plans freeze settings/references/masks at Start and submit one request at a time.
Editing while a run executes affects the next run. Stop after current collects its
result and prevents subsequent submissions. Cancel current and stop requests remote
cancellation; completion can win the race. Errors stop dispatch. Transient read-only
poll failures retry with bounded backoff; submission POSTs never retry automatically.
The WebUI blocks further generation while an accepted job is unresolved, even
after polling is paused. A non-secret tab-session marker preserves its identity
across reload. An uncertain submission must be checked in RunPod before explicitly
unlocking another request. Manually
resuming a known job reconciles its result but does not restart remaining automation.
The generation activity panel shows submission, queue/running status and elapsed
time. Stop generation requests remote cancellation, resumes paused status checks,
and waits for a server status response before reporting cancellation. A failed or
lost cancellation response remains unconfirmed and can be retried explicitly.
If completion wins the race, the result is retained. Stopping a series also leaves
its remaining requests unsent. No per-step percentage is inferred from elapsed time.
This is finite repetition, not a general reorderable queue. Reload/closing ends local
dispatch; remote jobs already submitted can continue. Keep the browser open.

Image history stays visible across Generate, Image edit, Inpaint and Outpaint.
Its recent thumbnails open saved generations without changing the job currently
being polled or cancelled. **All jobs** opens older history; **Current generation**
returns to the current run. Completed image jobs and partial raw results are kept
until you delete them. Switching menus and starting another run do not remove them.
Small previews decode one at a time; full-resolution files remain available.

Workers may return a smaller batch to fit their response limit. Every received
image is retained, missing images are labelled, and warnings explain JPEG fallback
or transparency flattened on white. Series/grid results map by seed; a partial batch
stops remaining requests without automatically regenerating omitted images.

Results for the active run remain accessible even beyond the ordinary history limit.
They stay as compressed Blobs; decoded bitmaps load on demand. Large runs still need
browser RAM. ZIP export accepts up to 100 files / 100 MB; export smaller selections
when necessary. ZIPs contain results and non-secret metadata, not portable projects.
Target-size export cannot rescue a result rejected by the frozen worker's output cap.

### Limits and estimates

Reference uploads accept single-frame PNG/JPEG/WebP, retain alpha and apply EXIF
orientation. Limits: ten references, 20 million pixels each, 40 million total and
100:1 aspect ratio. Resize/re-encoding is always explicit; JPEG flattens alpha on
white. Browsers can emit different PNG/WebP bytes from Pillow while remaining
valid worker references.

The estimator independently ports the frozen `memory.py` formulas from worker
commit `99c28f5d8a7fe0a5fa489ef4d619b1453198fccb`. GPU capacity, the flat safety addition and offload
mode are local assumptions, not worker settings. There is no live GPU telemetry.
Estimates cannot guarantee admission or prevent OOM. Tokenizer-dependent
positional checks remain authoritative on the worker. Custom weights/deployment
versions can invalidate model and output-bound assumptions.

The projection uses the same phase placement as `runtime._phase_tensor_budgets`.
`none` keeps all components resident; `text_encoder` includes all weights during
conditioning and DiT/VAE afterward; `model`/`sequential` reserve encoder+VAE during
conditioning, DiT+VAE during denoising, and VAE during decode. Encoder weights are
therefore counted only where the worker budgets them. Worker tensor/placement
fixtures verify parity. Extra safety is the only added allowance. The visible
offload selector must match the deployed `CPU_OFFLOAD`; live free VRAM and custom
checkpoint sizes cannot be inferred by the browser. The panel separates model
weights, worker tensors and extra safety, and includes the worker's log values.

The VRAM panel has editable GPU capacity plus a **0–10 GiB safety slider in
1 GiB steps**. Configure GPU offers common capacity presets, custom capacity and
the deployed offload mode. The safety amount is added once to each projected
peak, including a physical four-image batch, rather than multiplied per image.
Profiles persist per endpoint and work without entering API credentials. Legacy
`headroomGiB` settings migrate to `safetyGiB` with conservative whole-GiB rounding.

Green sequential and blue physical-batch bars share the same GPU-capacity scale;
amber segments show the flat safety addition. The **1–4× batch preview** defaults
to 4× and does not change the requested Images count. Expand the comparison for
all four batch sizes and phase peaks. Separate indicators show the current
request's predicted route and the preview route, including memory fallback and
the frozen worker's output-budget fallback. These are conservative local
predictions, not a command to force worker scheduling.

The CFG selector is a **1–4 slider in 0.1 steps** with a live value. The frozen
API still supports its original range: valid imported CFG values outside the
slider's range/step are explicitly preserved until the slider is moved.
Prompt normalization matches the worker's Python whitespace rules, rejecting
whitespace-only text before it can submit a job.

[Calculator preview](docs/vram-calculator.png) · [GPU configuration](docs/gpu-config.png).

Input fit does not guarantee output fit: a generated image can exceed the inline
cap after inference, with no partial success. PNG transport guidance assumes the
pinned worker encoder. JPEG/WebP size is uncertain. **Separate output jobs** is
an explicit option that submits one job at a time with consecutive exact seeds;
it repeats conditioning work and still cannot guarantee a single image fits.

Stopping polling or closing the tab does not cancel remote work. Submission
timeouts are never automatically retried. If a submission response is lost,
check RunPod before submitting again. RunPod currently retains asynchronous
results for 30 minutes after completion. This static UI does not run background
polling when the browser is closed.

## Modules

```text
src/api/          contract, exact JSON/seeds, RunPod transport and jobs
src/references/   image inspection/encoding and stable prompt-reference mapping
src/estimates/    worker memory formulas and PNG output transport bound
src/editor/       mask editor, crop transforms and alpha compositing
src/generation/   immutable request plans, series runner, grid planning and estimates
src/resources/    serialized/coalesced edit preparation and resource ownership
src/inspection/   shared viewer, coordinate mapping and alpha/RGB differences
src/export/       encoding/target-size search, lazy ZIP and contact sheets
src/state/        repository interface and in-memory default
src/domain/       versioned workspace and result descriptions
src/storage/      optional IndexedDB adapter and non-secret profiles
src/components/   studio layout, controls, estimates, references and results
src/app.ts        application orchestration
nginx/            restricted proxy, static serving and non-root startup
deploy/lxc/       native guest installation and update path
tests/            contract/geometry/parity, browser and real Nginx checks
```

The project has no runtime dependency on the worker repository.

Styles are separated into foundation, sidebar, workspace, controls, editor,
responsive and mobile modules. Connection/profile management, project persistence, history
and reference preparation have independent component controllers.

## Development and verification

Node 22.12+ or 24 is required for the build. Run:

```sh
npm ci
npm run dev
npm test
npm run build
```

Vite includes a development RunPod proxy. Production uses Nginx and its strict
route/body policies. Keep the development server local/trusted.

Browser checks use Chromium and mock RunPod; no paid inference is submitted:

```sh
CHROMIUM_PATH=/usr/bin/chromium npx playwright test
```

The packaging smoke test requires the built Docker image, local Docker socket,
OpenSSL and the already pulled Node base image. It creates a dedicated test
network and a local TLS fixture, then removes its containers/network:

```sh
python tests/packaging/nginx_smoke.py
```

Memory fixtures were recorded read-only from the frozen worker's pure CPU memory
module, and require no worker checkout to execute. Tests cover exact payload
boundaries, seeds, phase estimates, job errors, tag identity, masks and PNG
animation rejection. Browser checks cover generation, project restore, reference
reordering, responsive layout and outside-mask pixel preservation.

Live inference quality and measured GPU memory need verification against your
configured endpoint. A real Proxmox guest installation is an operator deployment
step; local packaging checks do not establish that a guest was deployed.
See the [verification record](docs/VERIFICATION.md) and [studio screenshot](docs/studio.png).

## Hosting and local data

Use HTTPS via your existing reverse proxy or Nginx TLS configuration whenever
credentials cross a network. Preserve `X-RunPod-Api-Key` and allow 10,000,000-byte
bodies at every proxy hop. Nginx converts that dedicated header into RunPod
Bearer authorization, so site Basic authentication can use Authorization
independently. An optional `nginx/site-auth.conf` and htpasswd mount can protect
the site; the default is a trusted personal/LAN deployment.

By default, projects, history, results, GPU profiles and endpoint selection remain in
this tab's memory. Enable **browser storage** to opt into IndexedDB/localStorage; its
non-secret preference is remembered. Save projects explicitly with the existing Save
project button. Existing saved projects/history are preserved and become available
when persistence is enabled. Disabling persistence does not delete saved data. There
is no new clear-state workflow or server database. A small non-secret pending-job
marker in tab session storage survives reload for submission safety; it contains
only endpoint/job identity and time, and is removed after resolution.

`historyLimit` (default 12) bounds older empty terminal failures. Successful image
jobs, partial raw results, and active jobs are not automatically evicted. The recent
thumbnail strip shows 12 generations; older images remain under **All jobs**.
Clearing site data removes persisted history/projects; reloading removes unsaved session data. Download important images,
export requests and masks, and keep source files separately. Storage-full errors
leave results available for immediate download. Keys are excluded from storage,
project data, exported requests and application logs.

See [the implementation plan](PLAN.md) for the original architecture and scope.

The 1.2.1 resource/compute and mobile audit is documented in [docs/WEBUI-AUDIT.md](docs/WEBUI-AUDIT.md).
