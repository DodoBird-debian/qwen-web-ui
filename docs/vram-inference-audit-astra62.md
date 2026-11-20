# Qwen-Image 2.1 VRAM and inference audit

## Why 24 GiB can work

With `CPU_OFFLOAD=text_encoder`, the worker keeps the transformer and VAE on the GPU and moves the text encoder onto the GPU for conditioning. At that point, the three components hold **30.21 GiB of BF16 weights**. The worker moves the encoder back to CPU before denoising. With `CPU_OFFLOAD=model`, component placement changes between phases, so many requests fit on a 24 GiB GPU. [Worker placement](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/main/qwen_worker/runtime.py)

The WebUI estimates below use one 512×512 output, the prompt “A vase,” no references, CFG 1, and prefix KV enabled.

| Offload | Estimated peak | Estimate with 3 GiB safety |
| --- | ---: | ---: |
| `text_encoder` | 33.28 GiB | 36.28 GiB |
| `model` | 20.02 GiB | 23.02 GiB |

Check `CPU_OFFLOAD` in the endpoint startup log and use the GPU's reported capacity when configuring the calculator. The worker and WebUI now default to `model` offload. The worker independently checks live available memory. [UI estimator](../src/estimates/memory.ts) · [Worker memory admission](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/main/qwen_worker/runtime.py)

## Bugs fixed

| Finding | Fix |
| --- | --- |
| The UI treated uncertain PNG, JPEG, and WebP delivery sizes as a reason to use sequential generation. For four 1024×1024 outputs, two square 1024 references, CFG 2, and KV on, the audited UI displayed **31.08 GiB** on an 80 GiB model-offload profile. With that simulated budget, the current worker admitted all four outputs in parallel. | The UI now predicts batching from the configured VRAM budget and displays the corresponding **66.18 GiB** buffered estimate for that example. Delivery warnings explain possible compression, resizing, or partial results. [Batch projection](../src/estimates/batching.ts) · [Output guidance](../src/estimates/output.ts) |
| Static endpoint metadata could lock the calculator to the wrong offload type. The audited sample profiles assumed `model`, and the worker originally defaulted to `text_encoder`. | Both selectors are editable. An optional endpoint hint seeds the estimate, and saved endpoint profiles take precedence. [GPU controls](../src/components/gpu-config.ts) |
| `inference_seconds` included time waiting for the pipeline lock and time spent encoding completed images. A controlled run with one second of pipeline work and seven seconds of output handling reported eight seconds. | The response now reports the sum of the pipeline calls in seconds. The job log still records wall time, lock wait, pipeline time, and encoding time. [Worker timings](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/main/qwen_worker/service.py) |
| The VRAM harness checked source hashes from an older Diffusers revision and aborted with the current pin. Production's hard transport ceiling also defeated the harness's relaxed output limit. | The fixture and report now use the worker's Diffusers revision. The benchmark child relaxes the transport ceiling for its runs so output fitting cannot truncate the planned workload. [Benchmark harness](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/main/scripts/benchmark_vram.py) · [Diffusers revision](https://github.com/huggingface/diffusers/commit/da1d3829cf08d4f329b526d89e17cc035c049d8d) |

## Where the VRAM model needs calibration

- **Conditioning uses the transformer token grid.** A square 1024 reference contributes 4,096 transformer positions and 1,024 language-model image slots. The estimator charges the larger count to the encoder. The worker already tokenizes the prompt in positional preflight. Reuse those counts and budget vision processing separately. Prompt-byte bounds are especially loose for long text. [Memory heuristic](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/main/qwen_worker/memory.py) · [Preflight](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/main/qwen_worker/preflight.py)
- **CFG denoising sums full temporary activation budgets for consecutive passes.** Both prefix caches can be live, but the positive and negative transformer calls run one after the other. Budget the live caches and each branch's own peak workspace. Distinguish initial prefix prefill from later cached steps. [Pinned CFG pipeline](https://github.com/huggingface/diffusers/blob/da1d3829cf08d4f329b526d89e17cc035c049d8d/src/diffusers/pipelines/qwenimage21/pipeline_qwenimage21.py#L759-L816)
- **Decode inherits the whole denoising allowance plus 16 bytes per pixel.** Prefix KV remains live into decode. The VAE has its own workspace and uses slicing and optional tiling. Model the tensors that survive the transition and measure the VAE peak separately. [Memory heuristic](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/main/qwen_worker/memory.py) · [Pinned VAE call](https://github.com/huggingface/diffusers/blob/da1d3829cf08d4f329b526d89e17cc035c049d8d/src/diffusers/pipelines/qwenimage21/pipeline_qwenimage21.py#L836-L856)
- **Sequential offload uses the whole-model budget.** The worker and calculator reserve the same component weights for both methods, although sequential offload stages submodules. Measure both policies before assigning a different budget. [Phase placement](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/main/qwen_worker/runtime.py)

The worker continues to use its conservative admission allowances while these phase peaks remain unmeasured. The checked-in comparison has 48 analytical cases and zero measured GPU peaks. It covers Base with text-encoder offload. A useful calibration workload for 24 GiB is Base or Turbo with the endpoint's actual offload mode, representative reference counts, and peak allocated and reserved VRAM per phase. [Benchmark guide](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/main/docs/VRAM_MEASUREMENT.md)

## Inference efficiency opportunities

1. **Choose the largest batch that fits.** The worker currently chooses between the full batch and one output at a time. The four-output reference example above admitted two outputs under a simulated 48 GiB memory budget. Running `2+2` would reduce four pipeline calls to two and preserve the seed sequence. Benchmark latency and throughput on the GPU. [Batch grouping](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/main/qwen_worker/service.py)
2. **Release prefix KV before VAE decode.** A square 1024 reference costs 2 GiB of persistent prefix KV per CFG branch per physical output. The pinned pipeline holds those caches through decode. With today's UI options, reducing reference processing to 512 cuts that contribution to 0.5 GiB while keeping the requested output dimensions. Reference detail can change. [KV accounting](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/main/qwen_worker/memory.py) · [Cache lifecycle](https://github.com/huggingface/diffusers/blob/da1d3829cf08d4f329b526d89e17cc035c049d8d/src/diffusers/pipelines/qwenimage21/pipeline_qwenimage21.py#L759-L854)
3. **Capture only the final pre-normalization encoder output.** The encoder retains all hidden states for a consumer that reads only the last one. Capture that output directly and compare embeddings for text and image prompts before deploying. [Pinned encoder path](https://github.com/huggingface/diffusers/blob/da1d3829cf08d4f329b526d89e17cc035c049d8d/src/diffusers/pipelines/qwenimage21/pipeline_qwenimage21.py#L293-L319)
4. **Move final CPU output fitting outside the inference lock.** Compression and resizing can repeat inside the same lock that protects the GPU pipeline. Keep any per-pass delivery check needed to stop wasteful sequential generation, and release the lock for final CPU-only fitting. [Service lifecycle](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/main/qwen_worker/service.py) · [Transport fitting](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/main/qwen_worker/transport.py)

## Verification

Before publishing, the staged WebUI passed the production build, 99 unit tests, 10 targeted browser tests, and 16 packaging tests. The worker passed 122 CPU tests. The local estimator returned 66.18 GiB and parallel routing for PNG, WebP, and JPEG in the four-output example. All four benchmark source hashes matched the pinned Diffusers revision. CUDA phase peaks and throughput on the live endpoint remain unmeasured.
