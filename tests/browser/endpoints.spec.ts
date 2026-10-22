import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page) {
  await page.route("**/config.json", route => route.fulfill({ json: {
    endpointId: "base-node", serverAuth: true, workerOffload: "model",
    models: { turbo: { endpointId: "turbo-node", serverAuth: true, workerOffload: "model" } },
  } }));
  await page.goto("/");
  await expect(page.locator("#connection-label")).toHaveText("base-node");
}
async function switchModel(page: Page, model: "base" | "turbo", id?: string, key?: string) {
  await page.locator("#connection-open").click();
  await page.locator("#endpoint-model").selectOption(model);
  if (id) await page.locator("#endpoint-id").fill(id);
  if (key) await page.locator("#api-key").fill(key);
  await page.locator("#connection-form button[type=submit]").click();
  await expect(page.locator("#connection-dialog")).not.toBeVisible();
}

test("model switching locks only Turbo, preserves base steps, imports and grid controls", async ({ page }) => {
  await setup(page);
  await page.locator("#steps").fill("40");
  await switchModel(page, "turbo");
  await expect(page.locator("#connection-label")).toHaveText("turbo-node");
  await expect(page.locator("#steps")).toHaveValue("8");
  await expect(page.locator("#steps")).not.toBeEditable();
  await page.locator("#run-kind").selectOption("grid");
  await expect(page.locator("#grid-x")).toHaveValue("seed");
  await expect(page.locator('#grid-x option[value="steps"]')).toHaveAttribute("disabled", "");
  await page.locator("#json-upload").setInputFiles({ name: "base.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ input: { prompt: "Imported image", num_inference_steps: 40 } })) });
  await expect(page.locator("#steps")).toHaveValue("8");
  await page.locator("#reset-settings").click();
  await expect(page.locator("#steps")).toHaveValue("8");
  await switchModel(page, "base");
  await expect(page.locator("#steps")).toBeEditable();
  await expect(page.locator("#steps")).toHaveValue("40");
  await expect(page.locator('#grid-x option[value="steps"]')).not.toHaveAttribute("disabled");
  await expect(page.locator("#grid-x")).toHaveValue("steps");
});

test("separate editable node credentials are used for health, generation and original-job cancellation", async ({ page }) => {
  const calls: { url: string; key?: string; steps?: number }[] = [];
  let cancelled = false;
  await page.route("**/api/runpod/**", route => {
    const request = route.request(), url = request.url();
    calls.push({ url, key: request.headers()["x-runpod-api-key"], steps: request.postDataJSON()?.input?.num_inference_steps });
    if (url.endsWith("/health")) return route.fulfill({ json: { workers: {} } });
    if (url.includes("/cancel/")) cancelled = true;
    return route.fulfill({ json: { id: "base-job", status: cancelled ? "CANCELLED" : url.endsWith("/run") ? "IN_QUEUE" : "IN_PROGRESS" } });
  });
  await setup(page);
  await switchModel(page, "turbo", "https://api.runpod.ai/v2/custom-turbo/runsync", "turbo-test-key");
  await page.locator("#connection-open").click();
  await page.locator("#connection-test").click();
  await expect(page.locator("#health-result")).toContainText("workers");
  await page.locator("#connection-dialog [data-close]").click();
  await switchModel(page, "base", "custom-base", "base-test-key");
  await page.locator("#prompt").fill("A vase");
  await page.locator("#width").fill("512");
  await page.locator("#height").fill("512");
  await page.locator("#steps").fill("20");
  await page.locator("#generate").click();
  await expect(page.locator("#generation-state")).toContainText("Generating image");
  await switchModel(page, "turbo");
  await expect(page.locator("#connection-label")).toHaveText("custom-turbo");
  await page.locator("#stop-generation").click();
  await expect(page.locator("#generation-state")).toHaveText("RunPod confirmed cancellation");
  expect(calls.find(c => c.url.endsWith("/health"))).toMatchObject({ key: "turbo-test-key" });
  expect(calls.find(c => c.url.endsWith("/run"))).toMatchObject({ key: "base-test-key", steps: 20 });
  expect(calls.find(c => c.url.includes("/cancel/"))).toMatchObject({ key: "base-test-key" });
  expect(calls.filter(c => c.url.includes("/status/")).every(c => c.url.includes("/custom-base/") && c.key === "base-test-key")).toBe(true);
  expect(calls.filter(c => c.url.includes("/cancel/")).every(c => c.url.includes("/custom-base/"))).toBe(true);
  await page.locator("#connection-open").click();
  await page.locator("#endpoint-id").fill("unconfigured-turbo");
  await expect(page.locator("#api-key")).toHaveAttribute("required", "");
  await page.locator("#endpoint-defaults").click();
  await expect(page.locator("#endpoint-id")).toHaveValue("turbo-node");
  await expect(page.locator("#api-key")).not.toHaveAttribute("required");
});

test("Turbo sends eight steps, uses its server default, and keeps existing results after switching", async ({ page }) => {
  let image = "";
  const calls: { url: string; key?: string; steps: number }[] = [];
  await page.route("**/api/runpod/**", route => {
    if (route.request().url().endsWith("/run")) {
      calls.push({ url: route.request().url(), key: route.request().headers()["x-runpod-api-key"], steps: route.request().postDataJSON().input.num_inference_steps });
      return route.fulfill({ json: { id: "turbo-job", status: "IN_QUEUE" } });
    }
    return route.fulfill({ json: { id: "turbo-job", status: "COMPLETED", output: { images: [
      { image_base64: image, mime_type: "image/png", width: 512, height: 512, seed: 42 },
    ] } } });
  });
  await setup(page);
  image = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = c.height = 512; return c.toDataURL().split(",")[1]; });
  await switchModel(page, "turbo");
  await page.locator("#prompt").fill("A Turbo vase");
  await page.locator("#width").fill("512");
  await page.locator("#height").fill("512");
  await page.locator("#generate").click();
  await expect(page.locator(".result-seed")).toHaveText("Seed 42");
  await switchModel(page, "base");
  await expect(page.locator(".result-seed")).toHaveText("Seed 42");
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ steps: 8, key: undefined });
  expect(calls[0].url).toContain("/turbo-node/run");
});

test("optional persistence restores model and endpoints without storing keys", async ({ page }) => {
  await setup(page);
  await page.locator("#persist-browser").check();
  await switchModel(page, "turbo", undefined, "private-turbo-key");
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(storage).not.toContain("private-turbo-key");
  await page.reload();
  await expect(page.locator("#connection-label")).toHaveText("turbo-node");
  await expect(page.locator("#steps")).toHaveValue("8");
  await expect(page.locator("#steps")).not.toBeEditable();
});

test("model configuration remains usable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.locator("#connection-open").click();
  await page.locator("#endpoint-model").selectOption("turbo");
  await expect(page.locator("#endpoint-id")).toHaveValue("turbo-node");
  const box = await page.locator("#connection-dialog").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "/tmp/qwen-endpoint-switch-phone.png" });
  await page.locator("#connection-form button[type=submit]").click();
  await expect(page.locator("#connection-label")).toHaveText("turbo-node");
});
