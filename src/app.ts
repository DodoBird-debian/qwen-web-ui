import { EditPreparationCache } from "./resources/edit-preparation";
import { GenerationActivity, finishedJob } from "./components/generation-activity";
import { bindMobileNavigation } from "./components/mobile-navigation";
import { WorkspaceEmptyState } from "./components/workspace-empty";
import { bindShortcuts } from "./components/shortcuts";
import { createTabSubmissionGuard } from "./generation/submission-guard";
import { estimatePlan } from "./generation/estimates";
import { bindRegions } from "./components/regions";
import { regionInstructions } from "./editor/prepare-edit";
import {
  expandedPlacement,
  extendToRatio,
  type Expansion,
} from "./editor/outpaint";
import { compilePrompt, referenceUses, roleInstruction } from "./references/prompt-compiler";
import { bindMentions } from "./references/mentions";
import { RunControls } from "./components/run-controls";
import { SeriesRunner } from "./generation/runner";
import { planSeries } from "./generation/plan";
import {
  getJob,
  put,
  trimHistory,
  setPersistence,
  persistenceEnabled,
} from "./storage/db";
import { bindHistory } from "./components/history";
import { ImageHistory } from "./components/image-history";
import { openReferencePreparation } from "./components/reference-preparation";
import { bindConnection } from "./components/connection";
import { EndpointConnections, MODEL_LABELS, type ModelVariant } from "./api/endpoints";
import { normalizeProfile } from "./estimates/profile";
import { bindGPUConfig, syncGPUInputs } from "./components/gpu-config";
import { loadProfile, saveProfile } from "./storage/db";
import { bindProjects, type ReusedInpaint } from "./components/projects";
import "./styles.css";
import { layout } from "./components/layout";
import { SettingsPanel } from "./components/settings";
import { renderReferences, renderGuides } from "./components/references";
import { renderEstimates, bindEstimatorControls } from "./components/estimates";
import { ResultsPanel } from "./components/results";
import { $, button, node, toast, download } from "./lib/dom";
import {
  DEFAULTS,
  MAX_REQUEST_BYTES,
  normalizeInput,
  prepare,
  randomSeed,
  nextSeed,
  type Input,
} from "./api/contract";
import { json, parseJson, LosslessNumber } from "./api/json";
import { RunpodClient, TERMINAL } from "./api/runpod";
import { JobManager, type SavedJob, type ResultImage } from "./api/jobs";
import {
  loadReference,
  releaseReference,
  validateReferences,
  fromBase64,
  canvasBlob,
  type Reference,
} from "./references/images";
import {
  insertAtCaret,
  remapTags,
  remapEditInstruction,
  validateTags,
} from "./references/tokens";
import { defaultProfile, type Profile } from "./estimates/memory";
import { MaskEditor, type Tool } from "./editor/mask-editor";
import { composite, type PreparedInpaint } from "./editor/inpaint";

$("#app").innerHTML = layout();
bindMobileNavigation();
type Mode = "generate" | "edit" | "inpaint";
let mode: Mode = "generate",
  references: Reference[] = [],
  profile: Profile = { ...defaultProfile };
let workspaceView: "editor" | "results" = "editor";
const connections = new EndpointConnections();
const modelProfiles: Record<ModelVariant, Profile> = { base: { ...defaultProfile }, turbo: { ...defaultProfile } };
let endpoint = "",
  working = false,
  submitting = false,
  version = 0,
  refreshTimer: ReturnType<typeof setTimeout>;
function workerOffload() {
  return connections.offload(endpoint);
}
function endpointProfile(): Profile {
  const saved = normalizeProfile(loadProfile(endpoint));
  const defaults = modelProfiles[connections.model];
  return saved ?? { ...defaults, offload: workerOffload() ?? defaults.offload };
}
let ready:
  | {
      body: string;
      bytes: number;
      input: Input;
      inpaint?: PreparedInpaint["snapshot"];
    }
  | undefined;
const preparationCache = new EditPreparationCache();
let reusedInpaint: { edit: ReusedInpaint; guides: Blob[] } | undefined;
const reusedInpaintNotice = node("p", "notice");
reusedInpaintNotice.id = "reused-inpaint";
reusedInpaintNotice.hidden = true;
$("#validation").after(reusedInpaintNotice);
let historyLimit = 12;
const prompt = $<HTMLTextAreaElement>("#prompt"),
  negative = $<HTMLTextAreaElement>("#negative-prompt");
const runControls = new RunControls($("#run-controls"), scheduleRefresh);
const settings = new SettingsPanel($("#settings"), scheduleRefresh, runControls);
const editor = new MaskEditor($("#canvas-viewport"), scheduleRefresh);
const results = new ResultsPanel($("#results"));
let runner: SeriesRunner | undefined;
let runId = 0;
let runRenderKey = "";
let displayedJob = "";
let viewedJob: SavedJob | undefined;
const imageHistory = new ImageHistory($("#image-history"), viewHistoryJob);
const emptyState = new WorkspaceEmptyState({
  browse: source => $(source ? "#source-upload" : "#reference-upload").click(),
  choose: chooseSource,
});
const renderRegions = bindRegions($("#region-panel"), editor);
const submissionGuard = createTabSubmissionGuard();
const submissionNotice = node("div", "notice submission-notice");
$("#job-status").after(submissionNotice);
const manager = new JobManager(
  {
    update: showJob,
    storageError: (message) => toast(message, true),
  },
  12,
  {
    save: async (record, limit) => {
      await put("jobs", record);
      await trimHistory(limit);
    },
  },
  composite,
  submissionGuard,
);
const activity = new GenerationActivity(
  $("#generation-activity"),
  stopGeneration,
  async () => { if (manager.current) await resume(manager.current); },
);

async function stopGeneration() {
  if (runner?.active) {
    const retry = !!manager.current?.cancelError;
    runner.cancel();
    if (!retry) return;
  }
  if (manager.current) await cancelJob(manager.current);
}

function renderActivity() {
  activity.update(submitting, manager.current, manager.polling, !!submissionGuard.pending);
  updateGenerateLabel();
}

async function submitJob(...args: Parameters<JobManager["submit"]>) {
  submitting = true;
  renderActivity();
  try {
    return await manager.submit(...args);
  } finally {
    submitting = false;
    renderActivity();
  }
}

async function cancelJob(record: SavedJob, transport?: RunpodClient) {
  try {
    await manager.cancel(transport || connections.client(record.endpoint), record);
    toast("Cancellation requested. Waiting for RunPod status confirmation.");
  } finally {
    // A paused/reloaded job must resume status checks after a cancellation,
    // including when the POST response was lost. Never mark it stopped locally.
    if (!manager.polling && !working && !finishedJob(record))
      void resume(record);
  }
}

function expansion(): Expansion | undefined {
  if (mode !== "inpaint" || !$<HTMLInputElement>("#outpaint-enabled").checked)
    return;
  const read = (side: string) =>
    Number($<HTMLInputElement>("#extend-" + side).value);
  return {
    left: read("left"),
    right: read("right"),
    top: read("top"),
    bottom: read("bottom"),
    seam: read("seam"),
  };
}
function referenceBindings() {
  const user = references.map((r) => ({
    id: r.id,
    alias: r.alias || r.name,
    role: r.role,
    name: r.name,
    url: r.url,
  }));
  return mode === "inpaint"
    ? [
        {
          id: `source-${editor.sourceId}`,
          alias: "Edit source",
          role: "source",
          name: "Edit source",
          url: "",
        },
        {
          id: `guide-${editor.sourceId}`,
          alias: "Edit guide",
          role: "guide",
          name: "Edit guide",
          url: "",
        },
        ...user,
      ]
    : user;
}
function renderOutpaintPreview() {
  const e = expansion();
  if (!e || !editor.loaded) return;
  const p = expandedPlacement(editor.source.width, editor.source.height, e),
    c = $<HTMLCanvasElement>("#outpaint-preview");
  const scale = Math.min(1, 320 / p.canvasWidth, 180 / p.canvasHeight);
  c.width = Math.max(1, Math.round(p.canvasWidth * scale));
  c.height = Math.max(1, Math.round(p.canvasHeight * scale));
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#646b68";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(
    editor.source,
    p.x * scale,
    p.y * scale,
    p.width * scale,
    p.height * scale,
  );
  ctx.strokeStyle = "#c5f16b";
  ctx.strokeRect(p.x * scale, p.y * scale, p.width * scale, p.height * scale);
  $("#outpaint-size").textContent =
    `Final canvas ${p.canvasWidth} × ${p.canvasHeight}. Worker ${settings.read().width} × ${settings.read().height}; fitted without stretching. ${p.canvasWidth > settings.read().width || p.canvasHeight > settings.read().height ? "Extension detail will be generated at a smaller working scale." : ""}`;
}
$("#open-outpaint").addEventListener("click", () => {
  $<HTMLInputElement>("#outpaint-enabled").checked = true;
  setMode("inpaint");
});
$("#extend-apply-ratio").addEventListener("click", () => {
  try {
    if (!editor.loaded) throw new Error("Load a source first.");
    const e = extendToRatio(
      editor.source.width,
      editor.source.height,
      Number($<HTMLSelectElement>("#extend-ratio").value),
      $<HTMLSelectElement>("#extend-anchor").value as
        | "center"
        | "start"
        | "end",
    );
    for (const side of ["left", "right", "top", "bottom"] as const)
      $<HTMLInputElement>("#extend-" + side).value = String(e[side]);
    scheduleRefresh();
  } catch (e) {
    toast(String(e), true);
  }
});
function storageNote() {
  $("#storage-mode-note").textContent = persistenceEnabled()
    ? "Saved in this browser · API keys stay in memory"
    : "Session only · reload ends local pending runs";
  imageHistory.note();
}
$("#persist-browser").addEventListener("change", async () => {
  const toggle = $<HTMLInputElement>("#persist-browser");
  const enabled = toggle.checked;
  toggle.disabled = true;
  try {
    await setPersistence(enabled);
    if (enabled) {
      saveProfile(endpoint, profile);
      if (endpoint) connections.persist();
    }
    localStorage.setItem("qwen-storage-enabled", String(enabled));
    storageNote();
    await imageHistory.restore();
    renderMode();
    toast(
      enabled
        ? "Browser persistence enabled. Existing saved projects/history are available."
        : "Session mode enabled. Previously saved data has not been deleted.",
    );
  } catch (e) {
    toggle.checked = persistenceEnabled();
    storageNote();
    toast(String(e), true);
  } finally {
    toggle.disabled = false;
  }
});
function resultActions() {
  return {
    reference: async (image: ResultImage) => {
      const ref = await loadReference(
        image.composite || image.blob,
        `Result ${image.seed}`,
      );
      try {
        if (references.length + (mode === "inpaint" ? 2 : 0) >= 10)
          throw new Error("Reference slots are full.");
        validateReferences([...references, ref]);
        references.push(ref);
        renderRefs();
        scheduleRefresh();
      } catch (e) {
        releaseReference(ref);
        throw e;
      }
    },
    inpaint: (image: ResultImage) => loadSource(image.composite || image.blob),
    reuse,
  };
}
function renderRun(identity: number) {
  if (!runner || identity !== runId) return;
  $("#run-status").hidden = false;
  $("#run-progress").textContent =
    `${runner.state} · ${runner.completed} / ${runner.plan.cells.length} images · ${runner.jobs.length} / ${runner.plan.requests.length} requests accepted`;
  $("#run-message").textContent =
    runner.error ||
    `${runner.plan.kind === "grid" ? "Comparison" : "Consecutive seeds"} · base seed ${runner.plan.baseSeed} · ${Math.floor((Date.now() - runner.started) / 1000)}s elapsed. ${runner.state === "stopped" ? "Unsent requests were not submitted." : runner.active ? "Browser must remain open." : ""}`;
  $<HTMLButtonElement>("#series-stop").disabled = !runner.active;
  $<HTMLButtonElement>("#series-cancel").disabled = !runner.active;
  const batchProgress = document.createDocumentFragment();
  runner.plan.requests.forEach((request, index) => {
    const states = request.cells.map(cell => runner!.cells.get(cell.id)!.status);
    const state = states.every(status => status === "completed") ? "completed"
      : states.includes("running") ? "running"
      : states.includes("omitted") ? "partial"
      : states.includes("failed") ? "failed"
      : states.includes("cancelled") ? "cancelled"
      : states.includes("unknown") ? "unconfirmed" : "pending";
    const item = button(`${index + 1} · ${request.cells.length} · ${state}`, () => {
      viewedJob = undefined;
      runRenderKey = "";
      workspaceView = "results";
      renderRun(identity);
      document.querySelector(`[data-cell-id="${request.cells[0].id}"]`)?.scrollIntoView({ block: "center" });
    }, `request-progress ${state}`);
    item.title = `Request ${index + 1}: ${request.cells.length} images · ${state}`;
    if (state === "running") item.setAttribute("aria-current", "step");
    batchProgress.append(item);
  });
  $("#run-batches").replaceChildren(batchProgress);
  if (viewedJob) return;
  const firstPresentation = !runRenderKey;
  const cells = runner.plan.cells.map((c) => ({
    id: c.id,
    label: c.label,
    ...runner!.cells.get(c.id)!,
  }));
  const key = cells
    .map((c) => `${c.id}:${c.status}:${c.result?.id || ""}:${c.error || ""}`)
    .join("|");
  if (key !== runRenderKey) {
    runRenderKey = key;
    results.showCollection(
      `run-${identity}`,
      cells,
      resultActions(),
      runner.plan.kind === "grid" ? runner.plan.columns.length : undefined,
    );
  }
  if (firstPresentation) workspaceView = "results";
  renderMode();
  $("#result-count").textContent =
    `${runner.completed} / ${runner.plan.cells.length} results`;
  if (firstPresentation) $("#results").scrollIntoView({ block: "start" });
}
$("#series-stop").addEventListener("click", () => runner?.stop());
$("#series-cancel").addEventListener("click", () => runner?.cancel());
window.addEventListener("beforeunload", (e) => {
  if (working) {
    e.preventDefault();
    e.returnValue = "";
  }
});

function dialog(title: string): HTMLElement {
  $("#content-title").textContent = title;
  const body = $("#content-body");
  body.replaceChildren();
  $<HTMLDialogElement>("#content-dialog").showModal();
  return body;
}
document.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).closest("[data-close]"))
    (event.target as HTMLElement).closest("dialog")?.close();
});
function ordered() {
  return mode === "inpaint"
    ? [
        { id: `source-${editor.sourceId}` },
        { id: `guide-${editor.sourceId}` },
        ...references,
      ]
    : references;
}
function rebind(previous: { id: string }[]) {
  const guideInstruction = $<HTMLTextAreaElement>("#inpaint-instruction");
  const previousUsers = previous.filter(
    r => !r.id.startsWith("source-") && !r.id.startsWith("guide-"),
  );
  guideInstruction.value = remapEditInstruction(guideInstruction.value, previousUsers, references);
  prompt.value = remapTags(prompt.value, previous, ordered());
  negative.value = remapTags(negative.value, previous, ordered());
  for (const region of editor.regions)
    region.instruction = remapEditInstruction(region.instruction, previousUsers, references);
  renderRegions();
}
function setMode(value: Mode) {
  const previous = ordered();
  mode = value;
  workspaceView = "editor";
  rebind(previous);
  renderMode();
  renderRefs();
  scheduleRefresh();
}
function renderMode() {
  emptyState.update(mode, !!expansion(), !!references.length, !!references.length || imageHistory.hasImages);
  document
    .querySelectorAll<HTMLElement>("[data-mode]")
    .forEach((element) =>
      element.classList.toggle(
        "active",
        element.dataset.mode === mode &&
          !(
            mode === "inpaint" &&
            $<HTMLInputElement>("#outpaint-enabled").checked
          ),
      ),
    );
  $("#workspace-title").textContent =
    mode === "inpaint"
      ? $<HTMLInputElement>("#outpaint-enabled").checked
        ? "Make space beyond the frame."
        : "A small change. A new direction."
      : mode === "edit"
        ? "Give your images a new story."
        : "Make room for an idea.";
  $("#editor-tools").hidden =
    $("#inpaint-options").hidden =
    $("#inpaint-ref-note").hidden =
      mode !== "inpaint";
  $("#inpaint-guides").hidden = mode !== "inpaint";
  $<HTMLInputElement>("#crop-mask").disabled = !!expansion();
  $<HTMLInputElement>("#crop-padding").disabled = !!expansion();
  $("#edit-panels").hidden = mode !== "inpaint";
  $("#outpaint-controls").hidden =
    !$<HTMLInputElement>("#outpaint-enabled").checked;
  $("#open-outpaint").classList.toggle(
    "active",
    mode === "inpaint" && $<HTMLInputElement>("#outpaint-enabled").checked,
  );
  document.querySelectorAll<HTMLElement>(".modes .mode").forEach(element =>
    element.setAttribute("aria-pressed", String(element.classList.contains("active"))));
  const showingResults =
    (!!viewedJob?.results?.length || !!runner || !!manager.current?.results?.length) &&
    (mode !== "inpaint" || workspaceView === "results");
  $(".workspace").classList.toggle("workspace-showing-results", showingResults);
  $(".workspace").classList.toggle(
    "workspace-editing",
    mode === "inpaint" && !showingResults,
  );
  $(".workspace").classList.toggle("workspace-extending", !!expansion());
  for (const id of ["editor-tools", "inpaint-options", "edit-panels"])
    $("#" + id).hidden = mode !== "inpaint" || showingResults || !editor.loaded;
  $("#canvas-viewport").hidden =
    mode !== "inpaint" || !editor.loaded || showingResults;
  $("#empty-state").hidden =
    showingResults || (mode === "inpaint" && editor.loaded);
  $("#results").hidden = !showingResults;
  $("#view-editor").hidden = mode !== "inpaint" || !showingResults;
  $("#view-results").hidden =
    mode !== "inpaint" ||
    showingResults ||
    (!viewedJob?.results?.length && !runner && !manager.current?.results?.length);
  $("#history-current").hidden = !viewedJob || (!runner && !manager.current);
  updateGenerateLabel();
}
function updateGenerateLabel() {
  let label = mode === "inpaint" ? "Generate edit" : "Generate image";
  if (runControls.kind === "series") label = "Run series";
  else if (runControls.kind === "grid") label = "Run comparison";
  if (working) label = "Working…";
  if (submissionGuard.pending) {
    label = "Job unresolved";
    if (manager.polling)
      label = manager.current?.status === "IN_QUEUE" ? "Queued…" : "Generating…";
    if (manager.current?.cancelRequested) label = "Stopping…";
  }
  if (submitting) label = "Submitting…";
  $("#generate").firstChild!.textContent = label + " ";
}
for (const element of document.querySelectorAll<HTMLElement>("[data-mode]"))
  element.addEventListener("click", () => {
    if (element.dataset.mode === "inpaint")
      $<HTMLInputElement>("#outpaint-enabled").checked = false;
    setMode(element.dataset.mode as Mode);
  });
$("#view-editor").addEventListener("click", () => {
  workspaceView = "editor";
  renderMode();
});
$("#view-results").addEventListener("click", () => {
  workspaceView = "results";
  renderMode();
});
$("#history-browse").addEventListener("click", () => $("#history-open").click());
$("#history-current").addEventListener("click", () => {
  viewedJob = undefined;
  runRenderKey = "";
  if (runner) renderRun(runId);
  else if (manager.current?.results?.length) showJob(manager.current);
  renderMode();
});
function viewHistoryJob(record: SavedJob) {
  viewedJob = record;
  results.show(record, resultActions());
  workspaceView = "results";
  $("#result-count").textContent = `${record.results?.length || 0} saved results`;
  renderMode();
  $("#results").scrollIntoView({ block: "start" });
}

function promptUses(index: number) {
  const bindings = referenceBindings();
  return referenceUses(prompt.value, bindings, index).length +
    referenceUses(negative.value, bindings, index).length;
}
function renderRefs() {
  const offset = mode === "inpaint" ? 2 : 0;
  $("#reference-count").textContent = `${references.length + offset} / 10`;
  renderReferences($("#references"), references, offset, {
    insert: (index) => insertAtCaret(prompt, `<image${index + offset + 1}>`),
    move: (index, delta) => {
      const previous = [...ordered()];
      [references[index], references[index + delta]] = [
        references[index + delta],
        references[index],
      ];
      rebind(previous);
      renderRefs();
      scheduleRefresh();
    },
    remove: (index) => {
      const previous = [...ordered()];
      releaseReference(references.splice(index, 1)[0]);
      rebind(previous);
      renderRefs();
      scheduleRefresh();
    },
    source: (index) => loadSource(references[index].blob, references[index].name),
    compress: (index) => compressionDialog(index),
    update: (index, patch) => {
      Object.assign(references[index], patch);
      renderRefs();
      scheduleRefresh();
    },
    helper: (index) =>
      insertAtCaret(
        prompt,
        "\n" +
          roleInstruction(
            references[index].role || "",
            `<image${index + offset + 1}>`,
          ) +
          "\n",
      ),
    uses: index => promptUses(index + offset),
    find: index => {
      const bindings = referenceBindings();
      for (const area of [prompt, negative]) {
        const [range] = referenceUses(area.value, bindings, index + offset);
        if (range) {
          area.focus();
          area.setSelectionRange(range.start, range.end);
          return;
        }
      }
      toast("This reference is not mentioned in the prompts.");
    },
  });
}
async function addFiles(files: File[]) {
  const loaded: Reference[] = [];
  try {
    if (references.length + files.length + (mode === "inpaint" ? 2 : 0) > 10)
      throw new Error(
        "At most ten references, including inpaint source and guide.",
      );
    for (const file of files) loaded.push(await loadReference(file, file.name));
    validateReferences([...references, ...loaded]);
    references.push(...loaded);
    renderRefs();
    scheduleRefresh();
  } catch (error) {
    loaded.forEach(releaseReference);
    throw error;
  }
}
$<HTMLInputElement>("#reference-upload").addEventListener(
  "change",
  async (event) => {
    const input = event.target as HTMLInputElement;
    try {
      await addFiles(Array.from(input.files || []));
    } catch (error) {
      toast(String(error), true);
    } finally {
      input.value = "";
    }
  },
);
const dropZone = $("#drop-zone");
for (const name of ["dragenter", "dragover"])
  dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
for (const name of ["dragleave", "drop"])
  dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
dropZone.addEventListener("drop", (event) => {
  addFiles(Array.from((event as DragEvent).dataTransfer?.files || [])).catch(
    (error) => toast(String(error), true),
  );
});
document.addEventListener("paste", (event) => {
  if (document.querySelector("dialog[open]")) return;
  const files = Array.from(event.clipboardData?.files || []);
  if (files.length) {
    event.preventDefault();
    receiveWorkspaceFiles(files).catch((error) => toast(String(error), true));
  }
});
async function receiveWorkspaceFiles(files: File[]) {
  if (mode === "inpaint" && !editor.loaded && files.length) {
    const [source, ...additional] = files;
    await loadSource(source, source.name);
    if (additional.length) await addFiles(additional);
  } else await addFiles(files);
}
for (const name of ["dragenter", "dragover"])
  $("#empty-state").addEventListener(name, event => {
    event.preventDefault();
    $("#empty-state").classList.add("dragging");
  });
for (const name of ["dragleave", "drop"])
  $("#empty-state").addEventListener(name, event => {
    event.preventDefault();
    $("#empty-state").classList.remove("dragging");
    if (name === "drop")
      receiveWorkspaceFiles(Array.from((event as DragEvent).dataTransfer?.files || []))
        .catch(error => toast(String(error), true));
  });

function compressionDialog(index: number) {
  openReferencePreparation(
    references[index],
    (prepared) => {
      const current = references.findIndex(
        (reference) => reference.id === prepared.id,
      );
      if (current < 0) throw new Error("Reference was removed.");
      releaseReference(references[current]);
      references[current] = {
        ...prepared,
        alias: references[current].alias,
        role: references[current].role,
      };
      renderRefs();
      scheduleRefresh();
    },
    dialog,
  );
}

function rawInput(): Input {
  const input: Input = { ...settings.read(), prompt: prompt.value, images: [] };
  if (input.true_cfg_scale > 1) input.negative_prompt = negative.value;
  return input;
}
function setReusedInpaint(edit?: ReusedInpaint) {
  reusedInpaint = edit && references.length >= 2
    ? { edit, guides: [references[0].blob, references[1].blob] }
    : undefined;
}
function matchingReusedInpaint({ width, height }: Pick<Input, "width" | "height">) {
  if (mode !== "edit" || !reusedInpaint) return;
  const { edit, guides } = reusedInpaint;
  const transform = edit.snapshot.transform;
  if (width === transform.width && height === transform.height &&
      guides.every((blob, index) => references[index]?.blob === blob)) return edit;
}
function renderSubmissionGuard() {
  renderActivity();
  submissionNotice.replaceChildren();
  const pending = submissionGuard.pending;
  submissionNotice.hidden = !pending || working;
  if (!pending || working) return;
  if (pending.id)
    submissionNotice.append(
      node(
        "span",
        "",
        "A remote job is unresolved. Resume its status or cancel it before generating again.",
      ),
    );
  else
    submissionNotice.append(
      node(
        "span",
        "",
        "The submission response was lost. Check your RunPod endpoint for a running job before starting another request.",
      ),
      button(
        "I checked RunPod; allow a new request",
        () => {
          submissionGuard.acknowledgeUnknown();
          scheduleRefresh();
        },
        "text-button",
      ),
    );
}
function scheduleRefresh() {
  version++;
  ready = undefined;
  $<HTMLButtonElement>("#generate").disabled = true;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refresh().catch((error) => toast(String(error), true));
  }, 250);
}
async function refresh() {
  renderMode();
  renderSubmissionGuard();
  syncGPUInputs(profile, workerOffload());
  for (const item of document.querySelectorAll<HTMLElement>(
    "[data-reference-uses]",
  )) {
    const index = ordered().findIndex(r => r.id === item.dataset.referenceUses);
    item.textContent = `${promptUses(index)} prompt uses`;
  }
  const requestVersion = version,
    raw = rawInput();
  $("#prompt-length").textContent =
    `${[...raw.prompt].length.toLocaleString()} / 20,000`;
  let actualRefs = [...references],
    inpaint: PreparedInpaint["snapshot"] | undefined;
  let failure = "";
  const savedEdit = matchingReusedInpaint(raw);
  reusedInpaintNotice.hidden = !reusedInpaint || mode !== "edit";
  if (!reusedInpaintNotice.hidden) {
    reusedInpaintNotice.textContent = savedEdit
      ? "Generation will apply the saved mask and placement." +
        (endpoint && savedEdit.endpoint !== endpoint
          ? ` This request uses ${endpoint}. The saved edit used ${savedEdit.endpoint}.` : "")
      : "The saved mask needs the original first two references and canvas dimensions. Generation will return a raw image.";
  }
  inpaint = savedEdit?.snapshot;
  if (mode === "inpaint") {
    try {
      if (!editor.loaded)
        throw new Error("Load a source and paint the area to edit.");
      const padding = Number($<HTMLInputElement>("#crop-padding").value),
        feather = Number($<HTMLInputElement>("#mask-feather").value);
      if (
        !Number.isFinite(padding) ||
        padding < 0 ||
        padding > 2048 ||
        !Number.isFinite(feather) ||
        feather < 0 ||
        feather > 100
      )
        throw new Error("Context must be 0–2048 px; feather must be 0–100 px.");
      if (
        raw.width < 256 ||
        raw.height < 256 ||
        raw.width > 4096 ||
        raw.height > 4096 ||
        raw.width * raw.height > 4_500_000
      )
        throw new Error("Set legal output dimensions before preparing guides.");
      const crop = $<HTMLInputElement>("#crop-mask").checked && !expansion();
      renderOutpaintPreview();
      const value = await preparationCache.get(editor, {
        width: raw.width,
        height: raw.height,
        crop,
        padding,
        feather,
        expansion: expansion(),
      });
      actualRefs = [...value.references, ...references];
      inpaint = value.snapshot;
      raw.prompt = `${$<HTMLTextAreaElement>("#inpaint-instruction").value}\n${regionInstructions(editor, !!expansion())}\nRequested edit: ${raw.prompt}`;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
  }
  if (requestVersion !== version) return;
  renderGuides(
    $("#inpaint-guides"),
    mode === "inpaint" && inpaint ? actualRefs.slice(0, 2) : [],
    (index) => insertAtCaret(prompt, `<image${index + 1}>`),
  );
  raw.images = actualRefs.map((reference) => reference.base64);
  try {
    raw.prompt = compilePrompt(raw.prompt, referenceBindings());
    if (raw.negative_prompt !== undefined)
      raw.negative_prompt = compilePrompt(
        raw.negative_prompt,
        referenceBindings(),
      );
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  const body = json({
    input: {
      ...raw,
      seed: /^-?\d+$/.test(raw.seed) ? new LosslessNumber(BigInt(raw.seed).toString()) : raw.seed,
    },
  });
  const bytes = new TextEncoder().encode(body).length;
  $<HTMLMeterElement>("#payload-meter").value = bytes;
  $("#payload-value").textContent = `${(bytes / 1_000_000).toFixed(2)} / 10 MB`;
  $("#inline-payload").textContent =
    `${(bytes / 1_000_000).toFixed(2)} / 10 MB`;
  $("#inline-payload").title =
    `${bytes.toLocaleString()} serialized request bytes`;
  $("#payload-message").textContent =
    `${bytes.toLocaleString()} bytes · ${Math.max(0, MAX_REQUEST_BYTES - bytes).toLocaleString()} remaining. Includes guides and base64.`;
  try {
    const preview = normalizeInput({
      ...raw,
      prompt: raw.prompt.trim() ? raw.prompt : "Preview",
    });
    renderEstimates(preview, actualRefs, profile, settings.separateJobs());
    runControls.describe(preview, raw.negative_prompt || "", settings.separateJobs());
  } catch {
    $("#memory-estimate").textContent =
      "Complete valid generation settings to estimate memory.";
  }
  try {
    if (failure) throw new Error(failure);
    if (mode === "edit" && !references.length)
      throw new Error("Add at least one reference for image editing.");
    if (
      !prompt.value.trim() &&
      !(
        mode === "inpaint" &&
        (expansion() ||
          editor.regions.some((r) => r.enabled && r.instruction.trim()))
      )
    )
      throw new Error(
        mode === "inpaint"
          ? "Describe the change to make."
          : "Add a prompt to get started.",
      );
    validateReferences(actualRefs);
    validateTags(raw.prompt, actualRefs.length);
    if (raw.true_cfg_scale > 1) validateTags(negative.value, actualRefs.length);
    ready = { ...prepare(raw), inpaint };
    const runPlan = runControls.describe(
      ready.input,
      runControls.kind === "grid" || raw.true_cfg_scale > 1
        ? compilePrompt(negative.value, referenceBindings())
        : "",
      settings.separateJobs(),
    );
    if (runPlan) {
      const summary = estimatePlan(runPlan, actualRefs, profile);
      renderEstimates(summary.worst.input, actualRefs, profile, false);
      $("#memory-estimate").prepend(
        node(
          "p",
          "notice",
          "Most demanding planned request · worker decides the actual route",
        ),
      );
      $("#run-summary").textContent +=
        ` Maximum predicted buffered peak ${(summary.worst.peak / 1024 ** 3).toFixed(2)} GiB. Within each request: ${summary.routes.join("; ")}.`;
    }
    $("#validation").textContent = "";
    $<HTMLButtonElement>("#generate").disabled =
      working || !!submissionGuard.pending;
  } catch (error) {
    ready = undefined;
    $("#validation").textContent =
      error instanceof Error ? error.message : String(error);
  }
}
prompt.addEventListener("input", scheduleRefresh);
negative.addEventListener("input", scheduleRefresh);
$("#negative-enable").addEventListener("click", () => {
  settings.enableNegative();
  negative.focus();
});
const mentions = bindMentions(
  [prompt, negative],
  $("#tag-suggestions"),
  referenceBindings,
);
$("#insert-tag").addEventListener("click", () => mentions.open());
for (const id of [
  "crop-mask",
  "crop-padding",
  "mask-feather",
  "inpaint-instruction",
  "outpaint-enabled",
  "extend-left",
  "extend-right",
  "extend-top",
  "extend-bottom",
  "extend-seam",
])
  $("#" + id).addEventListener("input", () => {
    renderMode();
    scheduleRefresh();
  });
for (const element of document.querySelectorAll<HTMLElement>("[data-example]"))
  element.addEventListener("click", () => {
    prompt.value = element.dataset.example!;
    scheduleRefresh();
    prompt.focus();
  });
$("#reset-settings").addEventListener("click", () => settings.reset());

function selectTool(tool: Tool) {
  if (editor.drawing) return;
  editor.tool = tool;
  document
    .querySelectorAll<HTMLElement>("[data-tool]")
    .forEach((item) => item.classList.toggle("active", item.dataset.tool === tool));
  editor.updateCursor();
}
for (const element of document.querySelectorAll<HTMLElement>("[data-tool]"))
  element.addEventListener("click", () => selectTool(element.dataset.tool as Tool));
$<HTMLInputElement>("#brush-size").addEventListener("input", (event) => {
  editor.brushSize = Number((event.target as HTMLInputElement).value);
  $("#brush-output").textContent = String(editor.brushSize);
  editor.updateCursor();
});
$("#canvas-viewport").addEventListener("editorzoom", event => {
  const select = $<HTMLSelectElement>("#canvas-zoom");
  select.querySelector("[data-custom-zoom]")?.remove();
  const value = String((event as CustomEvent<number>).detail);
  if (![...select.options].some(option => option.value === value)) {
    const option = node("option", "", `${Math.round(Number(value) * 100)}%`);
    option.value = value;
    option.dataset.customZoom = "true";
    select.append(option);
  }
  select.value = value;
});
$<HTMLSelectElement>("#canvas-zoom").addEventListener("change", (event) =>
  editor.setZoom(Number((event.target as HTMLSelectElement).value)),
);
for (const action of ["undo", "redo", "clear", "invert"] as const)
  $(`#mask-${action}`).addEventListener("click", () => editor[action]());
bindShortcuts({
  editor,
  selectTool,
  selectMode: index => {
    const selectors = ['[data-mode="generate"]', '[data-mode="edit"]', '[data-mode="inpaint"]', '#open-outpaint'];
    $(selectors[index]).click();
  },
  resizeBrush: delta => {
    const size = $<HTMLInputElement>("#brush-size");
    size.value = String(Math.max(2, Math.min(500, editor.brushSize + delta)));
    size.dispatchEvent(new Event("input", { bubbles: true }));
  },
  generate: async () => {
    if (working || submitting || submissionGuard.pending) return;
    // Commit region instruction change handlers before compiling the request.
    (document.activeElement as HTMLElement | null)?.blur();
    clearTimeout(refreshTimer);
    await refresh();
    $<HTMLButtonElement>("#generate").click();
  },
});
async function loadSource(blob: Blob, name = "Source") {
  const selection = editor.beginSourceLoad();
  const reference = await loadReference(blob, name);
  try {
    const previous = ordered();
    if (!await editor.load(reference.blob, undefined, selection)) return;
    $<HTMLSelectElement>("#canvas-zoom").value = "1";
    rebind(previous);
    setMode("inpaint");
  } finally {
    releaseReference(reference);
  }
}
async function chooseSource() {
  const body = dialog("Choose an edit source");
  const grid = node("div", "source-picker");
  body.append(grid);
  const urls: string[] = [];
  const entries = [
    ...references.map(ref => ({ blob: ref.blob, name: ref.alias || ref.name })),
    ...await imageHistory.sources(),
  ];
  if (!grid.isConnected || !$("#content-dialog").hasAttribute("open")) return;
  for (const entry of entries) {
    const pick = button(entry.name, async () => {
      await loadSource(entry.blob, entry.name);
      $<HTMLDialogElement>("#content-dialog").close();
    });
    const image = node("img");
    image.alt = "";
    image.loading = "lazy";
    image.src = URL.createObjectURL(entry.blob);
    urls.push(image.src);
    pick.prepend(image);
    grid.append(pick);
  }
  grid.before(node("p", "subtle", "References and recent results"));
  $<HTMLDialogElement>("#content-dialog").addEventListener("close", () => {
    urls.forEach(url => URL.revokeObjectURL(url));
  }, { once: true });
}
$<HTMLInputElement>("#source-upload").addEventListener(
  "change",
  async (event) => {
    const input = event.target as HTMLInputElement;
    try {
      if (input.files?.[0]) await loadSource(input.files[0]);
    } catch (error) {
      toast(String(error), true);
    } finally {
      input.value = "";
    }
  },
);
$<HTMLInputElement>("#mask-upload").addEventListener(
  "change",
  async (event) => {
    const input = event.target as HTMLInputElement;
    try {
      if (input.files?.[0]) await editor.importMask(input.files[0]);
    } catch (error) {
      toast(String(error), true);
    } finally {
      input.value = "";
    }
  },
);
$("#mask-export").addEventListener("click", () => {
  if (editor.loaded)
    editor
      .exportMask()
      .then((blob) => download(blob, "edit-mask.png"))
      .catch((error) => toast(String(error), true));
});

function client() {
  return connections.client();
}
function hasConnection() {
  return connections.connected;
}
const refreshConnection = bindConnection({
  connections,
  connect: (model, id, key) => {
    if (endpoint) saveProfile(endpoint, profile);
    connections.connect(model, id, key);
    endpoint = connections.current.endpoint;
    profile = endpointProfile();
    settings.setTurbo(model === "turbo");
    runControls.setTurbo(model === "turbo");
  },
  change: scheduleRefresh,
});

bindGPUConfig({
  endpoint: () => endpoint,
  profile: () => profile,
  workerOffload,
  setProfile: (value) => {
    profile = value;
  },
  change: scheduleRefresh,
});
bindEstimatorControls(scheduleRefresh);

function submissionPlan(input: Input) {
  const negativePrompt = runControls.kind === "grid"
    ? compilePrompt(negative.value, referenceBindings())
    : "";
  return runControls.plan(input, negativePrompt) ??
    (settings.separateJobs() && input.num_images > 1
      ? planSeries(input, input.num_images, 1)
      : undefined);
}

$("#generate").addEventListener("click", async () => {
  if (!ready || working || submissionGuard.pending) return;
  if (!hasConnection()) {
    refreshConnection();
    $<HTMLDialogElement>("#connection-dialog").showModal();
    return;
  }
  const frozen = ready,
    transport = client(),
    frozenEndpoint = endpoint;
  viewedJob = undefined;
  working = true;
  $<HTMLButtonElement>("#generate").disabled = true;
  try {
    const plan = submissionPlan(frozen.input);
    if (plan) {
      runRenderKey = "";
      const identity = ++runId;
      runner = new SeriesRunner(
        plan,
        (request) =>
          submitJob(
            transport,
            frozenEndpoint,
            request.prepared,
            frozen.inpaint,
          ),
        () => renderRun(identity),
        (job) => cancelJob(job, transport),
      );
      await runner.start();
    } else {
      runner = undefined;
      $("#run-status").hidden = true;
      $("#job-status").textContent = "Submitting to RunPod…";
      await submitJob(transport, frozenEndpoint, frozen, frozen.inpaint);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      toast("Polling stopped. The remote job may still be running.");
    else
      toast(
        `${error instanceof Error ? error.message : String(error)}${manager.current ? " You can resume by job ID." : " Submission may have reached RunPod. Check your endpoint before submitting again."}`,
        true,
      );
  } finally {
    working = false;
    scheduleRefresh();
    if (manager.current) showJob(manager.current);
    if (runner) renderRun(runId);
  }
});
function showJob(record: SavedJob) {
  imageHistory.remember(record);
  submitting = false;
  if (runner?.active) runner.known(record);
  else runner?.reconcile(record);
  const messages: Record<string, string> = {
    IN_QUEUE: "Queued — waiting for a worker",
    IN_PROGRESS: "Generating on RunPod",
    COMPLETED: "Completed",
    WORKER_ERROR: "Worker returned an error",
  };
  $("#job-status").textContent =
    `${messages[record.status] || record.status} · ${record.runpodId}${record.error ? ` · ${record.error}` : ""}${record.warning ? ` · ${record.warning}` : ""}`;
  const terminal =
    TERMINAL.has(record.status) ||
    ["WORKER_ERROR", "EXPIRED"].includes(record.status);
  $("#pause-job").hidden = !manager.polling;
  $("#resume-job").hidden = terminal || manager.polling;
  $("#cancel-job").hidden = terminal;
  $<HTMLButtonElement>("#cancel-job").disabled = !!record.cancelRequested && !record.cancelError;
  $<HTMLButtonElement>("#pause-job").disabled = !!record.cancelRequested && !terminal;
  renderActivity();
  if (record.results?.length && !viewedJob) {
    const firstPresentation = !runner && displayedJob !== record.id;
    if (!runner) {
      displayedJob = record.id;
      results.show(record, resultActions());
    }
    $("#result-count").textContent =
      `${record.results.length} result${record.results.length === 1 ? "" : "s"}`;
    if (!runner) workspaceView = "results";
    renderMode();
    if (firstPresentation) $("#results").scrollIntoView({ block: "start" });
  }
}
$("#pause-job").addEventListener("click", () => manager.pause());
$("#resume-job").addEventListener("click", () => {
  if (manager.current) resume(manager.current);
});
async function resume(record: SavedJob) {
  const pending = submissionGuard.pending;
  if (
    pending?.id &&
    (pending.id !== record.runpodId || pending.endpoint !== record.endpoint)
  ) {
    toast(
      "Resolve the current RunPod job before resuming a different one.",
      true,
    );
    return;
  }
  if (working) {
    toast("Stop current polling before resuming another job.");
    return;
  }
  working = true;
  scheduleRefresh();
  try {
    await initialized;
    const saved = await getJob(record.id);
    if (saved?.results?.length) {
      submissionGuard.completed(saved.endpoint, saved.runpodId);
      if (manager.current?.id === saved.id) {
        manager.current = saved;
        showJob(saved);
      }
      viewHistoryJob(saved);
      return;
    }
    // An in-memory job can have newer status or cancellation state.
    const current = manager.current?.id === record.id ? manager.current : undefined;
    record = current?.input.prompt ? current : saved ?? current ?? record;
    let transport: RunpodClient;
    try {
      transport = connections.client(record.endpoint);
    } catch {
      refreshConnection(record.endpoint);
      $<HTMLDialogElement>("#connection-dialog").showModal();
      toast("Connect to this job’s endpoint, then resume.");
      return;
    }
    viewedJob = undefined;
    if (runner && !runner.jobs.some(job => job.id === record.id)) {
      runner = undefined;
      $("#run-status").hidden = true;
    }
    await manager.follow(transport, record);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError"))
      toast(String(error), true);
  } finally {
    working = false;
    scheduleRefresh();
  }
}
$("#cancel-job").addEventListener("click", async () => {
  if (!manager.current) return;
  try {
    await stopGeneration();
  } catch (error) {
    toast(String(error), true);
  }
});

async function replaceInput(input: Input, savedEdit?: ReusedInpaint) {
  const loaded: Reference[] = [];
  try {
    for (const [index, image] of input.images.entries())
      loaded.push(await fromBase64(image, `Reference ${index + 1}`));
    validateReferences(loaded);
  } catch (error) {
    loaded.forEach(releaseReference);
    throw error;
  }
  references.forEach(releaseReference);
  references = loaded;
  editor.unload();
  $<HTMLInputElement>("#outpaint-enabled").checked = false;
  mode = loaded.length ? "edit" : "generate";
  setReusedInpaint(savedEdit);
  runControls.normal();
  settings.write(input);
  prompt.value = input.prompt;
  negative.value = input.negative_prompt || "";
  renderMode();
  renderRefs();
  scheduleRefresh();
}
async function reuse(record: SavedJob, seed?: string) {
  await replaceInput(
    { ...record.input, ...(seed ? { seed, num_images: 1 } : {}) },
    record.inpaint ? { snapshot: record.inpaint, endpoint: record.endpoint } : undefined,
  );
  toast("Request settings and references restored.");
}
$("#import-request").addEventListener("click", () =>
  $<HTMLInputElement>("#json-upload").click(),
);
$<HTMLInputElement>("#json-upload").addEventListener(
  "change",
  async (event) => {
    const fileInput = event.target as HTMLInputElement;
    try {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (file.size > MAX_REQUEST_BYTES)
        throw new Error("Imported JSON exceeds 10 MB.");
      const parsed = parseJson(await file.text());
      await replaceInput(normalizeInput(parsed.input ?? parsed));
      toast("Request imported.");
    } catch (error) {
      toast(String(error), true);
    } finally {
      fileInput.value = "";
    }
  },
);
$("#export-request").addEventListener("click", async () => {
  await refresh();
  if (!ready) {
    toast("Complete a valid request before exporting.", true);
    return;
  }
  const plan = submissionPlan(ready.input);
  const save = (body: string, filename: string) =>
    download(new Blob([body], { type: "application/json" }), filename);
  if (!plan || plan.requests.length === 1) {
    save(plan ? plan.requests[0].prepared.body : ready.body, "qwen-request.json");
    return;
  }
  const body = dialog("Export a planned request");
  if (ready.input.seed === "-1") body.append(node("p", "notice",
    `Starting seed for this export: ${plan.baseSeed}. Generate will choose a new random starting seed.`));
  for (const [index, request] of plan.requests.entries()) {
    body.append(button(`Download request ${index + 1} · ${request.cells.length} images`,
      () => save(request.prepared.body, `qwen-request-${index + 1}.json`)));
  }
});
$("#request-preview").addEventListener("click", async () => {
  await refresh();
  if (!ready) {
    toast("Complete a valid request to preview it.", true);
    return;
  }
  const request = ready;
  const random = request.input.seed === "-1";
  const plan = submissionPlan(random ? { ...request.input, seed: "0" } : request.input);
  const body = dialog("API request preview");
  const notice = node("p", "notice");
  const text = node("pre", "json-preview");
  const render = (index: number) => {
    const planned = plan?.requests[index];
    const input = planned
      ? { ...planned.cells[0].input, num_images: planned.cells.length }
      : request.input;
    const bytes = planned?.bytes ?? request.bytes;
    notice.textContent = plan && random
      ? "Example body. Random starting seeds resolve at submission."
      : `Submitted body: ${bytes.toLocaleString()} bytes. Base64 is abbreviated here.`;
    text.textContent = json({
      input: {
        ...input,
        seed: new LosslessNumber(input.seed),
        images: input.images.map((value, i) =>
          `[image${i + 1}: ${value.length.toLocaleString()} base64 characters]`),
      },
    }, true);
  };
  if (plan) {
    const label = node("label", "field", `${plan.cells.length} images across ${plan.requests.length} requests`);
    const select = node("select");
    plan.requests.forEach(({ cells }, index) => {
      const option = node("option", "", `Request ${index + 1} · ${cells.length} image${cells.length === 1 ? "" : "s"}`);
      option.value = String(index);
      select.append(option);
    });
    select.addEventListener("change", () => render(Number(select.value)));
    label.append(select);
    body.append(label);
  }
  render(0);
  body.append(notice, text);
});

bindProjects({
  dialog,
  capture: async () => {
    const input = rawInput();
    const snapshot = {
      schemaVersion: 2 as const,
      mode,
      input,
      reusedInpaint: matchingReusedInpaint(input),
      references: references.map(({ id, name, blob, alias, role }) => ({
        id, name, blob, alias, role,
      })),
      expansion: expansion(),
      crop: $<HTMLInputElement>("#crop-mask").checked,
      padding: $<HTMLInputElement>("#crop-padding").value,
      feather: $<HTMLInputElement>("#mask-feather").value,
      instruction: $<HTMLTextAreaElement>("#inpaint-instruction").value,
    };
    if (!editor.loaded) return snapshot;
    const [source, mask, regions] = await Promise.all([
      canvasBlob(editor.source),
      canvasBlob(editor.combinedMask()),
      editor.saveRegions(),
    ]);
    return { ...snapshot, source, mask, regions };
  },
  restore: async (project) => {
    const loaded: Reference[] = [];
    try {
      for (const ref of project.references)
        loaded.push({
          ...(await loadReference(ref.blob, ref.name, ref.id)),
          alias: ref.alias,
          role: ref.role,
        });
    } catch (error) {
      loaded.forEach(releaseReference);
      throw error;
    }
    references.forEach(releaseReference);
    references = loaded;
    mode = project.mode;
    setReusedInpaint(project.reusedInpaint);
    runControls.normal();
    settings.write(project.input);
    prompt.value = project.input.prompt;
    negative.value = project.input.negative_prompt || "";
    editor.unload();
    if (project.source) {
      await editor.load(project.source, project.mask);
      if (project.regions) await editor.loadRegions(project.regions);
    }
    $<HTMLSelectElement>("#canvas-zoom").value = "1";
    $<HTMLInputElement>("#outpaint-enabled").checked = !!project.expansion;
    if (project.expansion)
      for (const side of ["left", "right", "top", "bottom", "seam"] as const)
        $<HTMLInputElement>("#extend-" + side).value = String(
          project.expansion[side],
        );
    $<HTMLInputElement>("#crop-mask").checked = project.crop;
    $<HTMLInputElement>("#crop-padding").value = project.padding;
    $<HTMLInputElement>("#mask-feather").value = project.feather;
    const instruction = $<HTMLTextAreaElement>("#inpaint-instruction");
    instruction.value = project.instruction ?? instruction.defaultValue;
    renderMode();
    renderRefs();
    scheduleRefresh();
  },
});

bindHistory({
  dialog,
  endpoint: () => endpoint,
  resume,
  reuse,
  view: viewHistoryJob,
  removed: (id) => imageHistory.forget(id),
});

async function initialize() {
  try {
    const response = await fetch("/config.json", { cache: "no-store" });
    const config = await response.json();
    connections.configure(config);
    const configuredProfile = normalizeProfile(config.models?.base) ?? normalizeProfile(config);
    if (configuredProfile) modelProfiles.base = configuredProfile;
    const turboProfile = normalizeProfile(config.models?.turbo);
    if (turboProfile) modelProfiles.turbo = turboProfile;
    if (
      Number.isInteger(config.historyLimit) &&
      config.historyLimit >= 1 &&
      config.historyLimit <= 100
    )
      historyLimit = config.historyLimit;
  } catch {
    /* Defaults work without runtime configuration. */
  }
  try {
    if (localStorage.getItem("qwen-storage-enabled") === "true") {
      await setPersistence(true);
      $<HTMLInputElement>("#persist-browser").checked = true;
      storageNote();
    }
    if (persistenceEnabled()) connections.restore();
  } catch {
    /* Storage optional. */
  }
  endpoint = connections.current.endpoint;
  profile = endpointProfile();
  settings.setTurbo(connections.model === "turbo");
  runControls.setTurbo(connections.model === "turbo");
  if (hasConnection()) {
    $("#connection-label").textContent = endpoint;
    $("#connection-label").title = MODEL_LABELS[connections.model];
    $("#connection-dot").classList.add("connected");
  }
  manager.setHistoryLimit(historyLimit);
  const pending = submissionGuard.pending;
  if (pending?.id) {
    const id = `${pending.endpoint}:${pending.id}`;
    let saved: SavedJob | undefined;
    try {
      saved = await getJob(id);
    } catch {
      toast("The saved job could not be loaded.", true);
    }
    manager.current = saved ?? {
      id,
      runpodId: pending.id,
      endpoint: pending.endpoint,
      created: pending.created,
      status: "IN_QUEUE",
      input: { ...DEFAULTS },
    };
    if (saved && finishedJob(saved))
      submissionGuard.completed(pending.endpoint, pending.id);
    showJob(manager.current);
  }
  try { await imageHistory.restore(); } catch { toast("Saved image history could not be loaded.", true); }
  refreshConnection();
  renderRefs();
  renderMode();
  scheduleRefresh();
}
const initialized = initialize();
renderSubmissionGuard();
