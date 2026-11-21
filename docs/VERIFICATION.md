# Verification record

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
