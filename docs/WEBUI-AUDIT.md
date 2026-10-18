# WebUI audit — 1.2.1

2026-10-18. Scope: the standalone WebUI. The frozen worker and its request schema
remain unchanged. Inference used deterministic browser fixtures, never a paid endpoint.

## Compute and recovery

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

## Browser resources

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
  loading/cloning every result and base64 input. IndexedDB v2 upgrades existing v1
  history in place. Active jobs are not evicted by completed-history limits.
- Returned image headers, dimensions, image count and encoded size are checked
  before pixel decoding. Completed stored results are displayed without refetching
  and recompositing them.

Native canvas encodes already in progress cannot be cancelled. The current encode
finishes, then cancellation prevents the remaining work. Large sources, decoded
inspection canvases, retained results and ZIPs still require browser memory; the
existing pixel/file/run bounds continue to apply.

## Phone usability

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

## Extension boundaries

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

## Verification

See [VERIFICATION.md](VERIFICATION.md) for commands and the final test record.
Regression coverage includes unresolved/reloaded jobs, uncertain submissions,
expired IDs, stable result nodes/URLs, preparation coalescing, metadata edits,
feather inheritance, export cancellation, history migration/pruning and touch
inpainting through result inspection. Production remains Nginx-only.
