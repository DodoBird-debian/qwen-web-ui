# Follow-up bug review, 21 November 2026

The fixes and regression tests are recorded in the coverage report. [Fix coverage](bug-fix-coverage-astra62.md)

Nine additional bugs were open when originally reported. The first two can erase a painted mask or apply it to a different region. The review used the WebUI and worker working trees based on `5de1314` and `deedfce`, respectively, including their local edits. [Earlier bug review](bug-review-2026-11-21-astra62.md)

## Fixed · 1. A slow source upload can erase a newer edit

In Inpaint, delay the file read for a red source, select a blue source, and paint its center. When the red file finished reading, it replaced the blue canvas and the center mask alpha fell from 255 to 0. The editor assigns its load version after the initial file read and validation, so the first selection can reach the editor last. [Source selection](../src/app.ts#L997) · [Editor load version](../src/editor/mask-editor.ts#L127)

**Regression check.** Release the delayed red file after painting the blue image. The source pixel should still be blue and the mask alpha should still be 255.

## Fixed · 2. A mask import can overwrite a different region

Create two empty regions. In region 1, start importing a solid white mask. Select region 2 before the file finishes reading. The center mask alpha ended at 0 in region 1 and 255 in region 2. The importer checks the source version but writes through `this.mask`, which follows the current region selection. [Upload handler](../src/app.ts#L1048) · [Mask write](../src/editor/mask-editor.ts#L538)

**Regression check.** Repeat the delayed import and switch regions. Region 1 should receive the white mask and region 2 should retain its original pixels.

## Fixed · 3. Switching modes breaks a valid inpaint source reference

Paint a region and give it the instruction `Match the object in <image1>.` Confirm that Generate is enabled. Switch to Generate mode, then back to Inpaint with the same source. The region instruction now held a `<missing:…>` marker and validation disabled generation. Leaving Inpaint removes the source and guide from the temporary reference list used to rewrite region instructions. [Mode change and tag remapping](../src/app.ts#L411)

**Regression check.** After the round trip, inspect both the region instruction and the request preview. The instruction should still reference the original source as `<image1>`, and the edit should be ready to submit.

## Fixed · 4. Export JSON can save a different seed from the submitted request

Set the base seed to `41`. Create a one-cell comparison grid with seed `123` as its only column value and no row axis. The API preview and outgoing request both contained `123`. **Export JSON** wrote `41` to `qwen-request.json` because it serialized the base form before the grid override. [JSON export](../src/app.ts#L1315) · [Preview of the planned request](../src/app.ts#L1334)

**Regression check.** For this one-request grid, compare the downloaded JSON with the body captured on submission. Both should contain seed `123`.

## Fixed · 5. An empty API-key field can keep an old override active

On an endpoint with server authentication configured, save a manual key, reopen the connection dialog, and save with the key field empty. The dialog says this selects the server default. The next health request still sent the manual key in `X-RunPod-Api-Key`. **Use model defaults** cleared the override in the same test. [Key selection and dialog guidance](../src/components/connection.ts#L17) · [Default reset](../src/components/connection.ts#L57)

**Regression check.** Save an empty field on the configured endpoint and inspect the next health request. It should omit the override header. Entering a fresh manual key should send that key on the next request.

## Fixed · 6. The VRAM benchmark can record the wrong checkpoint revision

Point `MODEL_PATH` at a structurally valid Base snapshot whose directory names a different revision from the benchmark pin. In a CPU fixture, the resolver accepted the explicit directory while the benchmark result recorded the revision from its specification. The fixture stopped before loading weights. A subsequent measurement from such a path could therefore be attributed to the wrong checkpoint. [Benchmark result initialization](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/deedfcec1b6e5056127837d4fac9a6a51b249619/scripts/benchmark_vram.py#L302) · [Explicit path resolution](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/deedfcec1b6e5056127837d4fac9a6a51b249619/qwen_worker/runtime.py#L173)

**Regression check.** Supply two Base snapshot directories with different revision names. The pinned revision should pass the identity check. The mismatch should be reported before measurement so it cannot produce a result attributed to the pin.

## Fixed · 7. A custom matrix output directory still overwrites the tracked report

In a disposable worker checkout, add a marker to `docs/VRAM_COMPARISON.md` and run `python scripts/vram_matrix.py --output-dir /tmp/qwen-comparison`. The CSV and JSON appeared in the requested directory. The Markdown writer used a fixed repository path and erased the marker. [Matrix output paths](https://github.com/DodoBird-debian/qwen-image-2.1-worker/blob/deedfcec1b6e5056127837d4fac9a6a51b249619/scripts/vram_matrix.py#L252)

**Regression check.** With a custom output directory, verify that all three artifacts are written there and compare the tracked report byte-for-byte with its original contents.

## Fixed · 8. Reference usage counts and Find uses miss aliases

Give an uploaded reference the alias `vase` and enter `Use @{vase}` in the main prompt. The API preview correctly showed `Use <image1>`. The reference card reported zero uses, and **Find uses** said the reference was absent. Both controls search the raw text for numbered tags. [Alias compilation](../src/references/prompt-compiler.ts#L8) · [Find uses](../src/app.ts#L580) · [Usage count refresh](../src/app.ts#L752)

**Regression check.** The card should report one use for this prompt. **Find uses** should select the literal `@{vase}` in the editable text while the outgoing prompt contains `<image1>`.

## Fixed · 9. A leading zero in the seed disables generation

With a valid prompt, enter `0041` in the seed field. The payload meter attempts to serialize those digits as a JSON number before integer normalization. Chromium displayed `Invalid number` and Generate stayed disabled, even though the contract's integer normalizer accepts that text as seed `41`. [Payload meter serialization](../src/app.ts#L835) · [Integer normalization](../src/api/json.ts#L22)

**Regression check.** Enter `0041`, wait for validation, and submit to a mock endpoint. Generate should enable and the outgoing JSON should contain the numeric seed `41`.

## Verification scope

The seven WebUI reproductions ran in Chromium against a mocked RunPod endpoint. All 102 existing WebUI unit tests passed during that review. The two worker checks used a CPU fixture and a disposable checkout. Live GPU inference was outside these checks.
