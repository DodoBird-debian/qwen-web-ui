import { $, toast } from "../lib/dom";
import { json } from "../api/json";
import { RunpodClient } from "../api/runpod";
import { loadProfile, persistenceEnabled } from "../storage/db";
import { normalizeProfile, type Profile } from "../estimates/profile";

export interface ConnectionContext {
  endpoint: () => string;
  key: () => string;
  serverEndpoint: () => string;
  profile: () => Profile;
  connect: (endpoint: string, key: string) => void;
  setProfile: (value: Profile) => void;
  change: () => void;
}
export function bindConnection(context: ConnectionContext) {
  const syncKeyRequirement = () => {
    const endpoint = $<HTMLInputElement>("#endpoint-id").value.trim();
    const serverDefault = !!endpoint && endpoint === context.serverEndpoint();
    const input = $<HTMLInputElement>("#api-key");
    input.required = !serverDefault;
    input.placeholder = serverDefault ? "Use server default, or enter another key" : "rpa_…";
    $("#connection-dialog .notice").textContent = serverDefault
      ? "Leave the key empty to use this endpoint's server default. An entered key stays in this tab's memory."
      : "The key stays in this tab's memory. Re-enter it after reload. Nginx forwards requests to RunPod.";
  };
  $("#endpoint-id").addEventListener("input", syncKeyRequirement);
  $("#connection-open").addEventListener("click", () => {
    syncKeyRequirement();
    $<HTMLDialogElement>("#connection-dialog").showModal();
  });
  $("#connection-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const endpoint = $<HTMLInputElement>("#endpoint-id").value.trim(),
        key = $<HTMLInputElement>("#api-key").value;
      new RunpodClient(endpoint, key, undefined, context.serverEndpoint());
      context.connect(endpoint, key);
      const stored = normalizeProfile(loadProfile(endpoint));
      if (stored) context.setProfile(stored);
      try {
        if (persistenceEnabled())
          localStorage.setItem("qwen-endpoint", endpoint);
      } catch {
        /* Optional persistence. */
      }
      $("#connection-label").textContent = endpoint;
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
        $<HTMLInputElement>("#endpoint-id").value.trim(),
        $<HTMLInputElement>("#api-key").value || context.key(),
        undefined,
        context.serverEndpoint(),
      );
      const health = await test.health();
      $("#health-result").hidden = false;
      $("#health-result").textContent = json(health, true);
    } catch (error) {
      toast(String(error), true);
    }
  });
  return syncKeyRequirement;
}
