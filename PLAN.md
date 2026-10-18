# Qwen Image 2.1 Web UI — implementation plan

Status: implemented as a modular standalone project. This document preserves the
original plan; see README.md for delivered behavior and verification commands.

This is a standalone browser application in `/workspace/qwen-image-2.1-webui`.
The worker checkout at `/workspace/qwen-image-2.1-worker` remains unchanged.
Compatibility is based on worker commit `99c28f5d8a7fe0a5fa489ef4d619b1453198fccb`.

## 1. Architecture and deployment boundaries

```text
Browser: editor, references, masks, estimates, local projects
        | same-origin HTTP requests
Nginx: static assets + restricted HTTPS RunPod proxy
        | unchanged RunPod JSON body and Bearer authentication
RunPod queue API: /v2/{endpoint}/run, /status/{job}, /cancel/{job}, /health
        |
Existing frozen worker
```

- TypeScript, Vite, native DOM components, CSS, Canvas 2D and IndexedDB.
- Use a small lossless JSON dependency for 64-bit seeds; keep dependencies local
  and locked. No CDN assets or runtime package downloads.
- Node is required to develop/build, but the deployed service runs Nginx only.
  No inference code, model downloads, GPU dependencies, application server or
  server database is part of this project.
- Produce the same static `dist/` artifact for Docker and native Nginx in an
  unprivileged Proxmox Debian LXC. LXC does not require nested Docker.
- No runtime imports, shared volumes, relative source imports or deployment
  dependency on the worker checkout.

## 2. Interface and complete API coverage

Build a responsive studio with Generate, Edit and Inpaint modes. Desktop has a
reference tray, a central canvas/results workspace, and generation settings;
smaller screens use collapsible panels. Keep prompt editing and payload/VRAM
feedback accessible while working. Include keyboard operation, visible focus,
labels, canvas zoom/pan, a transparency checkerboard and clear validation errors.

Expose every supported request option with the worker's defaults:

| API field | UI behavior and validation |
| --- | --- |
| `prompt` | Required; 1–20,000 Unicode code points; image reference insertion |
| `width`, `height` | Default 1024 each; supply both; 256–4096; multiples of 32; at most 4,500,000 pixels |
| `aspect_ratio` | Alternative to explicit dimensions; show exact resolved size before submission |
| `num_inference_steps` | Default 40; integer 1–100 |
| `seed` | Random (`-1`) or exact decimal integer through 9223372036854775807 |
| `num_images` | Default 1; integer 1–4 |
| `images` | Ordered list of up to ten base64 references |
| `transparent` | Default false; requires PNG or WebP |
| `output_format` | PNG default; WebP or JPEG |
| `quality` | Default 95; integer 1–100; explain that PNG and alpha WebP ignore this value |
| `true_cfg_scale` | Default 1.0; finite 1–20 |
| `negative_prompt` | Enabled only when CFG > 1; omit when CFG <= 1 |
| `output_resolution` | Default 1024; 512/1024/2048; label as reference processing resolution |
| `use_kv_cache` | Default true; explain speed/memory implications |

Aspect presets use the frozen mapping: 1:1=2048x2048, 4:3=2400x1792,
3:4=1792x2400, 3:2=2528x1696, 2:3=1696x2528, 16:9=2752x1536 and
9:16=1536x2752. Selecting a square ratio must not silently imply the default
1024-square output.

Build a single contract module that validates and serializes the allowed fields.
Keep canvas state, masks, UI modes, GPU profiles and local project metadata out
of `input`. Preserve exact large integer seeds in request serialization, returned
results, seed increment/wrap, imports, exports and history. Native JavaScript
Number/JSON parsing must not round seeds.

Provide request JSON import/export and a readable final request preview with
image byte sizes rather than large base64 dumps. Import validates the same
allowlist as normal controls. Check invalid Unicode and Unicode character count
without relying on JavaScript UTF-16 string length.

## 3. References and `<imageN>` prompt insertion

- Upload, drop or paste local PNG/JPEG/WebP images; use browser Blob previews.
- Show one-based labels and an Insert `<image1>` action on every thumbnail.
  Include caret insertion, autocomplete, repeated references and hover previews.
- Track images by stable internal IDs. Reference tokens render/serialize to the
  current ordered `<imageN>` label; reordering must keep references attached to
  the same image. Removing an image marks affected tokens as unresolved until
  the user repairs them.
- Send each image once in the ordered `images` array, regardless of repeated
  mentions in the prompt. Never insert model-internal vision/image-pad tokens.
- Apply consistent EXIF orientation, retain alpha, and validate up to 20 million
  pixels per reference, 40 million total, 100:1 maximum aspect ratio, one frame
  and ten slots. Restrict initial file support to formats that can be inspected
  reliably in the browser; reject animated inputs rather than silently taking
  their first frame.
- Offer explicit resize, crop and compression actions with before/after sizes
  and previews. Keep original files available. Never automatically discard
  alpha, lower quality or resize references merely to make a request fit.
- Use raw base64 in API requests, avoiding data-URI prefix overhead. Do not send
  filesystem paths or external image URLs.

## 4. Inpainting compatible with the frozen API

The worker has no `mask_image`, `mask`, `strength` or denoising-strength input.
Unknown fields are rejected. Therefore this is a mask-guided reference-editing
workflow followed by local compositing, rather than native masked diffusion.

1. Choose an oriented source image and paint the editable area on a separate
   mask layer. Include brush/eraser, adjustable size, rectangle selection,
   invert/clear, undo/redo, mask import/export and a feather preview.
2. Prepare the source and an annotated or visual-mask guide as ordinary reference
   images. Generate an editable instruction explaining their `<imageN>` roles.
   Show exactly which references will be submitted. Two guide references consume
   two of the ten slots and count toward all payload and VRAM estimates.
3. Support full-image editing and a crop-around-mask option with adjustable
   context padding. Explicitly normalize the generation rectangle to legal
   dimensions; retain the crop/scale/pad transforms for result placement.
4. Send only supported frozen fields. The mask itself remains local, except for
   its optional visual representation in the ordinary reference list.
5. Transform the generated image back to source coordinates and composite it
   through the mask. Pixels outside the editable/feathered region come from the
   source. Keep original, raw worker output and final composite separately.
6. Offer before/after comparison and downloads. Raw outputs retain the worker's
   format and metadata. A composite is labeled as a local derivative; PNG is
   the default composite export to preserve unchanged pixels and alpha. Lossy
   composite exports must not claim pixel identity with the source.

Local compositing preserves untouched source pixels, but cannot guarantee model
alignment, edit quality or seamless boundaries within the selected area. Measure
and test transforms and blending independently of model quality. Empty masks,
missing sources and incompatible dimensions must be caught before submission.

## 5. Exact RunPod payload budgeting

- Enforce a maximum of **10,000,000 bytes** for the entire final serialized
  `/run` request body, including `{"input":...}`, UTF-8 prompts, seeds, reference
  base64, generated inpaint guides and any enabled top-level RunPod policy.
- Serialize once, measure the resulting UTF-8 bytes, and send that same body.
  Editing any relevant state invalidates the prepared request and its byte count.
- Independently enforce the worker's 10,000,000-character combined reference
  string cap. Approximately 7.5 MB of binary images already becomes 10 MB of
  base64 before text/envelope overhead.
- Display exact used/remaining bytes plus each reference's contribution. Block
  oversize submission and offer explicit compression/resizing or removal.
- Set Nginx `client_max_body_size 10000000`, not `10m` (which is 10 MiB).
  Preserve the body; do not use multipart or gzip as a limit workaround.
- Warn separately about the worker's **8,000,000-byte inline output cap**, with
  its 4,096-byte envelope/timing allowance. Input fit does not imply output fit.
  Output size cannot be predicted exactly before generation.
- Port the frozen PNG transport upper bound for route guidance. An uncertain
  bound is a warning/routing indication, not a new request rejection rule.
  JPEG/WebP batches have no guaranteed-fit bound in this worker.
- Keep normal `num_images` behavior. Offer a separately selected one-image-per-job
  queue with explicit seed scheduling if desired; clearly show that this creates
  multiple jobs and cannot guarantee that even a single large output will fit.

## 6. VRAM estimator

Port the reviewed `memory.py` formulas into a self-contained TypeScript module,
including Python ties-to-even rounding for reference grids. Record the source
commit and estimator version, and include fixed golden cases for parity checks.

Inputs are actual oriented reference sizes, both prompt branches, transparency
prompt framing, reference processing resolution, output dimensions, CFG state,
KV cache state and requested output count. Use the worker's UTF-8 text bounds,
not guessed tokens-per-character ratios.

Show:

- Estimated conditioning, denoising and decoding request tensors.
- Prefix KV storage, reference/target tokens and sequential/parallel comparison.
- Projected total peak including BF16 model weights and deployment placement.
- Estimated route: sequential fit failure, sequential, or parallel candidate;
  then the separate output-transport override to sequential.
- Practical suggestions: fewer references, lower reference resolution, cache
  off, lower output dimensions or different deployment offload configuration.

Provide endpoint-associated profiles for GPU capacity in GiB, deployment offload
mode (`text_encoder` default, `none`, `model`, `sequential`), safety headroom and
optional manually supplied phase budgets. These describe an existing deployment;
they do not change the worker's environment through the API.

Parameter payloads from the pinned checkpoint provide model-weight baselines;
buffers, allocation state, kernel workspaces and other GPU processes introduce
uncertainty. The frozen API has no live VRAM telemetry, so label these values as
heuristic estimates and expose the profile assumptions. Do not claim an exact
admission decision, measured peak or guaranteed freedom from OOM. Inference
steps and seed do not enter the frozen memory estimate.

Exact positional preflight needs the pinned processor/tokenizer and is still
authoritative on the worker. Do not bundle a large tokenizer into the base UI or
pretend that the 20,000-character check proves positional validity. Surface
worker positional errors with the relevant reduction suggestions.

## 7. RunPod client and job lifecycle

- Enter endpoint ID and API key in a connection panel. Validate endpoint/job IDs;
  use only queue-based RunPod operations. Health checks must not submit a job.
- Keep API keys in browser memory for the current tab, not in localStorage,
  IndexedDB, static build files, URLs, project exports or logs. Re-enter the key
  after reload to resume a saved job.
- Use async `/run` and poll `/status/{job}` with bounded backoff/jitter. Persist
  the job ID and input snapshot immediately after a successful submission.
- Show IN_QUEUE, IN_PROGRESS, COMPLETED, FAILED, CANCELLED and TIMED_OUT with
  elapsed queue/run time where available. Avoid invented denoising-step progress:
  this worker does not expose it.
- Handle both RunPod errors and `COMPLETED` responses containing `output.error`.
  Do not rely on `refresh_worker` reaching the client.
- Recover polling after connectivity loss or reload when a job ID is known.
  Do not automatically repeat a submission after an ambiguous timeout, and
  disable proxy retries for submission requests to prevent duplicate jobs.
- Distinguish stopping local polling from explicit `/cancel/{job}`. Closing the
  tab or aborting a fetch is not remote cancellation.
- Capture completed results promptly in optional bounded IndexedDB history;
  RunPod async results currently expire 30 minutes after completion. Local
  history is browser-local and is not a server-side background job monitor.
- Preserve full submitted settings locally because returned `parameters` contain
  only a subset. Support downloads, reuse seed/settings, send a result to the
  reference tray, and reopen it in the inpaint editor.
- Decode result base64 into Blobs, verify expected image MIME types and revoke
  Blob URLs when unused. Handle local storage quota failures gracefully.

## 8. Nginx packaging for Docker and Proxmox LXC

The browser calls `/api/runpod/...` on its own origin. Nginx proxies only an
allowlisted set of methods/routes to fixed `https://api.runpod.ai/v2/...`; the
UI cannot supply an arbitrary upstream hostname. Configure TLS certificate
verification, SNI, DNS, request size limits and bounded proxy timeouts correctly.
Do not cache API responses or record API keys/request bodies in access logs.

Pass the user's RunPod key in a dedicated same-origin header, convert it to
upstream Bearer authorization and strip the dedicated header upstream. This
also keeps optional Nginx site Basic authentication separate from RunPod auth.
Supply TLS/reverse-proxy and optional site-auth examples for shared deployments.

Docker deliverables:

- Multi-stage Dockerfile: locked frontend build followed by a minimal Nginx
  runtime with CA certificates; pin the selected base version/digest.
- Compose example, non-root runtime on port 8080, read-only static files and
  temporary writable Nginx directories; no worker volume or GPU access.
- Runtime config file for non-secret defaults and a local health endpoint.
- Document build, start, configuration, update and rollback commands.

Proxmox LXC deliverables:

- Native Debian LXC installation instructions and an inspectable installer that
  runs inside an existing unprivileged guest. It installs Nginx/CA packages,
  static release files and the matching site configuration.
- Same static release as Docker; Node is unnecessary if installing a prebuilt
  release. No privileged LXC or Docker nesting requirement.
- Validate configuration before reload, preserve operator configuration on
  update, and document service management and rollback.
- Initial sizing target: one vCPU and 256–512 MiB guest RAM for the UI service;
  verify actual use during packaging. Image editing runs in the user's browser.
- Document LAN access, optional TLS at an existing reverse proxy and optional
  site authentication. Do not create or alter a Proxmox guest/host during UI
  development.

## 9. Planned project layout

```text
qwen-image-2.1-webui/
  PLAN.md
  README.md
  package.json
  package-lock.json
  src/
    app.ts
    styles.css
    api/                 # contract, lossless JSON, RunPod transport/jobs
    references/          # files, image ordering, prompt reference tokens
    editor/              # canvas, masks, transforms, local compositing
    estimates/           # worker memory and output-bound ports
    storage/             # profiles, projects, job history
    components/          # settings, connection, meters, gallery
  public/config.json     # non-secret defaults
  tests/fixtures/        # contract, memory, job/result and image cases
  nginx/                 # common proxy policy and runtime variants
  deploy/lxc/            # guest install/update scripts and documentation
  Dockerfile
  compose.yaml
  .dockerignore
  dist/                  # generated release
```

## 10. Implementation order and acceptance

1. **Contract and transport:** scaffold the separate project; implement request
   validation, lossless seeds, payload accounting, RunPod state handling and
   the restricted Nginx proxy. Verify with a local mock upstream.
2. **Generation and references:** implement all controls, prompt reference
   insertion, image preprocessing, upload budgeting and results/gallery flows.
3. **Estimates:** add independent VRAM/output modules, deployment profiles,
   phase visualizations and parity fixtures.
4. **Inpainting:** implement mask editing, reference guide preparation, crop
   transforms, compositing, comparisons and separate raw/composite downloads.
5. **Persistence and recovery:** finish browser-local projects/history,
   reconnect/resume and storage quota handling.
6. **Packaging and documentation:** finish Docker/Compose and native LXC release
   installation/update paths, examples and verification instructions.

Acceptance checks will cover:

- Every API field/default and incompatibility: paired dimensions versus aspect
  ratio, CFG/negative prompt, alpha/format, reference limits and unknown fields.
- Seeds at/above JavaScript's safe integer limit, maximum seed, random returned
  seed, batch increment and wrap; lossless import/export and saved history.
- Exact 10,000,000-byte request boundaries, Unicode prompts, ten references and
  guide-image overhead; Nginx rejection and normal forwarding boundaries.
- Estimator parity for CFG, cache, transparency, reference aspect ratios,
  ties-to-even rounding, sequential/batch phases and output-route overrides.
- Prompt reference reorder/delete behavior and reserved placeholder validation.
- Canvas coordinate alignment under zoom, EXIF orientation, crop/pad/resize,
  feathering, source alpha and preservation outside the editable region.
- Mocked queue transitions, completed worker errors, auth failure, rate limits,
  disconnects, ambiguous submission, cancellation and reload/resume.
- Production frontend build, Nginx config validation, Docker runtime smoke and
  native-LXC packaging checks where the environment supports them. Report any
  unavailable checks rather than claiming a real Proxmox deployment.

Actual RunPod inference and mask-guidance quality require a configured endpoint
and credentials. Mock integration can verify UI behavior and the frozen contract;
it cannot establish GPU memory accuracy or model editing quality. Implementation
will not alter worker files or submit paid jobs merely to test the UI.

## Evidence reviewed

- Frozen worker: `qwen_worker/requests.py`, `images.py`, `memory.py`,
  `output_budget.py`, `preflight.py`, `service.py`, `runtime.py`, `config.py`,
  `handler.py`, `scripts/client.py` and `scripts/vram_matrix.py` at the commit above.
- Worker docs: `QWEN_IMAGE_2_1_ARCHITECTURE.md`, `docs/FIXES_IMPLEMENTED.md`,
  `docs/VRAM_COMPARISON.md` and `docs/qwen-image-2.1-spec.json`.
- [RunPod request and job documentation](https://docs.runpod.io/serverless/endpoints/send-requests).
- [Pinned Diffusers Qwen-Image 2.1 pipeline](https://github.com/huggingface/diffusers/blob/e0118ade2f60234c41bacf40330a7e2f61108849/src/diffusers/pipelines/qwenimage21/pipeline_qwenimage21.py).
