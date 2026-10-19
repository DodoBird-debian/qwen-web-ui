import { $, toast } from "../lib/dom";
import { saveProfile } from "../storage/db";
import { validProfile, type Profile, type Offload } from "../estimates/profile";

interface GPUConfigContext {
  endpoint: () => string;
  profile: () => Profile;
  workerOffload: () => Offload | undefined;
  setProfile: (profile: Profile) => void;
  change: () => void;
}
export function syncGPUInputs(profile: Profile, workerOffload?: Offload) {
  $<HTMLInputElement>("#gpu-inline-capacity").value = String(profile.gpuGiB);
  $<HTMLInputElement>("#safety-adder").value = String(profile.safetyGiB);
  $<HTMLSelectElement>("#gpu-inline-offload").value = profile.offload;
  $<HTMLSelectElement>("#gpu-inline-offload").disabled = !!workerOffload;
  $<HTMLSelectElement>("#gpu-offload").disabled = !!workerOffload;
  $("#worker-offload-note").textContent = workerOffload
    ? "Using this endpoint's configured worker offload"
    : "Match CPU_OFFLOAD on your worker";
  $("#safety-output").textContent = `+${profile.safetyGiB} GiB`;
}
export function bindGPUConfig(context: GPUConfigContext) {
  function commit(profile: Profile) {
    profile = { ...profile, offload: context.workerOffload() ?? profile.offload };
    context.setProfile(profile);
    syncGPUInputs(profile, context.workerOffload());
    try {
      saveProfile(
        context.endpoint() || $<HTMLInputElement>("#endpoint-id").value.trim(),
        profile,
      );
    } catch {
      toast(
        "GPU profile is available for this tab; browser storage is unavailable.",
      );
    }
    context.change();
  }
  $("#gpu-inline-capacity").addEventListener("input", () => {
    const field = $<HTMLInputElement>("#gpu-inline-capacity"),
      value = Number(field.value);
    field.setCustomValidity(
      Number.isFinite(value) && value >= 1 && value <= 1024
        ? ""
        : "Enter a capacity between 1 and 1024 GiB.",
    );
    if (field.checkValidity()) commit({ ...context.profile(), gpuGiB: value });
  });
  $("#safety-adder").addEventListener("input", () => {
    const safetyGiB = Number($<HTMLInputElement>("#safety-adder").value);
    if (Number.isInteger(safetyGiB) && safetyGiB >= 0 && safetyGiB <= 10)
      commit({ ...context.profile(), safetyGiB });
  });
  $("#gpu-inline-offload").addEventListener("change", () => {
    const profile = { ...context.profile(), offload: $<HTMLSelectElement>("#gpu-inline-offload").value };
    if (validProfile(profile)) commit(profile);
  });
  $("#profile-open").addEventListener("click", () => {
    const profile = context.profile();
    syncGPUInputs(profile, context.workerOffload());
    $<HTMLInputElement>("#gpu-capacity").value = String(profile.gpuGiB);
    $<HTMLSelectElement>("#gpu-preset").value = "custom";
    $<HTMLInputElement>("#gpu-safety").value = String(profile.safetyGiB);
    $("#gpu-safety-output").textContent = `+${profile.safetyGiB} GiB`;
    $<HTMLSelectElement>("#gpu-offload").value = profile.offload;
    $<HTMLDialogElement>("#profile-dialog").showModal();
  });
  $("#gpu-preset").addEventListener("change", () => {
    const value = $<HTMLSelectElement>("#gpu-preset").value;
    if (value !== "custom") $<HTMLInputElement>("#gpu-capacity").value = value;
  });
  $("#gpu-capacity").addEventListener("input", () => {
    $<HTMLSelectElement>("#gpu-preset").value = "custom";
  });
  $("#gpu-safety").addEventListener("input", () => {
    $("#gpu-safety-output").textContent =
      `+${$<HTMLInputElement>("#gpu-safety").value} GiB`;
  });
  $("#profile-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const profile = {
      gpuGiB: Number($<HTMLInputElement>("#gpu-capacity").value),
      safetyGiB: Number($<HTMLInputElement>("#gpu-safety").value),
      offload: $<HTMLSelectElement>("#gpu-offload").value,
    };
    if (!validProfile(profile)) {
      toast(
        "Enter valid GPU capacity and a whole-GiB safety addition from 0 to 10.",
        true,
      );
      return;
    }
    commit(profile);
    $<HTMLDialogElement>("#profile-dialog").close();
  });
}
