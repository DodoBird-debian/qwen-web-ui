import { $, toast } from "../lib/dom";
import { json } from "../api/json";
import { RunpodClient } from "../api/runpod";
import { loadProfile, persistenceEnabled } from "../storage/db";
import { normalizeProfile, type Profile } from "../estimates/profile";
import { endpointId, MODEL_LABELS, type EndpointConnections, type ModelVariant, type EndpointCredentials } from "../api/endpoints";

export interface ConnectionContext {
  connections: EndpointConnections;
  connect: (model: ModelVariant, endpoint: string, key: string) => void;
  setProfile: (value: Profile) => void;
  change: () => void;
}
export function bindConnection(context: ConnectionContext) {
  const connections = context.connections;
  const selector = $<HTMLSelectElement>("#endpoint-model");
  let draft: Record<ModelVariant, EndpointCredentials>;
  let selected: ModelVariant = connections.model;
  const keyForDraft = () => {
    const id = endpointId($<HTMLInputElement>("#endpoint-id").value);
    return $<HTMLInputElement>("#api-key").value || (draft[selected].endpoint === id ? draft[selected].key : "");
  };
  const syncKeyRequirement = () => {
    let endpoint = "";
    try { endpoint = endpointId($<HTMLInputElement>("#endpoint-id").value); } catch { /* Incomplete field. */ }
    const serverDefault = !!connections.serverEndpoint(endpoint);
    const savedKey = draft?.[selected].endpoint === endpoint && !!draft[selected].key;
    const input = $<HTMLInputElement>("#api-key");
    input.required = !serverDefault && !savedKey;
    input.placeholder = savedKey ? "Use this model's saved key, or enter another" : serverDefault ? "Use server default, or enter another key" : "rpa_…";
    $("#connection-dialog .notice").textContent = serverDefault
      ? "Leave the key empty to use this endpoint's server default. An entered key stays in this tab's memory."
      : "The key stays in this tab's memory. Re-enter it after reload. Nginx forwards requests to RunPod.";
    $("#endpoint-model-note").textContent = selected === "turbo"
      ? "Turbo uses a fixed 8-step schedule. Steps lock to 8 when connected."
      : "Base model: denoising steps remain editable.";
  };
  const showDraft = () => {
    selector.value = selected;
    $<HTMLInputElement>("#endpoint-id").value = draft[selected].endpoint;
    $<HTMLInputElement>("#api-key").value = "";
    $("#health-result").hidden = true;
    syncKeyRequirement();
  };
  const refresh = (target?: string) => {
    draft = { base: { ...connections.saved.base }, turbo: { ...connections.saved.turbo } };
    selected = target ? (["base", "turbo"] as const).find(m => draft[m].endpoint === target) ?? connections.model : connections.model;
    if (target) draft[selected] = { endpoint: target, key: draft[selected].endpoint === target ? draft[selected].key : "" };
    showDraft();
  };
  selector.addEventListener("change", () => {
    let id = $<HTMLInputElement>("#endpoint-id").value.trim();
    let key = $<HTMLInputElement>("#api-key").value;
    try { key = keyForDraft(); id = endpointId(id); } catch { /* Preserve incomplete draft without a key. */ }
    draft[selected] = { endpoint: id, key };
    selected = selector.value as ModelVariant;
    showDraft();
  });
  $("#endpoint-defaults").addEventListener("click", () => {
    draft[selected] = { endpoint: connections.presets[selected].endpointId, key: "" };
    showDraft();
  });
  $("#endpoint-id").addEventListener("input", syncKeyRequirement);
  $("#connection-open").addEventListener("click", () => {
    refresh();
    $<HTMLDialogElement>("#connection-dialog").showModal();
  });
  $("#connection-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const endpoint = endpointId($<HTMLInputElement>("#endpoint-id").value),
        key = keyForDraft();
      context.connect(selected, endpoint, key);
      const stored = normalizeProfile(loadProfile(endpoint));
      if (stored) context.setProfile(stored);
      try {
        if (persistenceEnabled())
          connections.persist();
      } catch {
        /* Optional persistence. */
      }
      $("#connection-label").textContent = endpoint;
      $("#connection-label").title = MODEL_LABELS[selected];
      $("#connection-dot").classList.add("connected");
      $<HTMLInputElement>("#api-key").value = "";
      $<HTMLDialogElement>("#connection-dialog").close();
      context.change();
      toast(key ? "Connection settings saved in this tab." : "Using the server's RunPod default.");
    } catch (error) {
      toast(String(error), true);
    }
  });
  $("#connection-test").addEventListener("click", async () => {
    try {
      const test = new RunpodClient(
        endpointId($<HTMLInputElement>("#endpoint-id").value),
        keyForDraft(),
        undefined,
        connections.serverEndpoint(endpointId($<HTMLInputElement>("#endpoint-id").value)),
      );
      const health = await test.health();
      $("#health-result").hidden = false;
      $("#health-result").textContent = json(health, true);
    } catch (error) {
      toast(String(error), true);
    }
  });
  return refresh;
}
