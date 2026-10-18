# Verification record

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
