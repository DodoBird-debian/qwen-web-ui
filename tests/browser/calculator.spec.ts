import { test, expect, type Page } from "@playwright/test";

async function slide(page: Page, selector: string, value: number) {
  await page.locator(selector).evaluate((element: HTMLInputElement, value) => {
    element.value = String(value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test("GPU capacity and whole-GiB flat safety update both bars and persist without credentials", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#persist-browser").check();
  await expect(page.locator("#storage-mode-note")).toContainText("Saved in this browser");
  await page.locator("#prompt").fill("A ceramic vase");
  await expect(page.locator(".vram-comparison")).toHaveCount(2);
  await expect(page.locator("#safety-adder")).toHaveAttribute("min", "0");
  await expect(page.locator("#safety-adder")).toHaveAttribute("max", "10");
  await expect(page.locator("#safety-adder")).toHaveAttribute("step", "1");
  await page.locator("#gpu-inline-capacity").fill("40");
  await slide(page, "#safety-adder", 10);
  await expect(page.locator(".actual-route")).toHaveAttribute(
    "data-route",
    "over-capacity",
  );
  const bars = await page.locator(".vram-comparison").evaluateAll((elements) =>
    elements.map((element) => ({
      raw: Number((element as HTMLElement).dataset.rawBytes),
      safety: Number((element as HTMLElement).dataset.safetyBytes),
      total: Number((element as HTMLElement).dataset.totalBytes),
    })),
  );
  for (const bar of bars) {
    expect(bar.safety).toBe(10 * 1024 ** 3);
    expect(bar.total - bar.raw).toBe(bar.safety);
  }
  await page.locator("#safety-adder").focus();
  await page.locator("#safety-adder").press("Home");
  await expect(page.locator("#safety-output")).toHaveText("+0 GiB");
  await expect(page.locator(".actual-route")).toHaveAttribute(
    "data-route",
    "single",
  );
  await page.locator("#profile-open").click();
  await page.locator("#gpu-preset").selectOption("96");
  await slide(page, "#gpu-safety", 5);
  await page.locator("#profile-form button[type=submit]").click();
  await expect(page.locator("#gpu-inline-capacity")).toHaveValue("96");
  await expect(page.locator("#safety-output")).toHaveText("+5 GiB");
  await page.reload();
  await expect(page.locator("#gpu-inline-capacity")).toHaveValue("96");
  await expect(page.locator("#safety-output")).toHaveText("+5 GiB");
});

test("four-image preview is independent of submission and distinguishes memory and transport routing", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#prompt").fill("A test image");
  await expect(page.locator("#batch-preview-count")).toHaveValue("4");
  await expect(page.locator("#image-count")).toHaveValue("1");
  await expect(page.locator(".vram-comparison.parallel")).toContainText(
    "4× physical batch",
  );
  await expect(page.locator(".preview-route")).toHaveAttribute(
    "data-route",
    "sequential-output",
  );
  await expect(page.locator(".actual-route")).toHaveAttribute(
    "data-route",
    "single",
  );
  await page.locator("#image-count").selectOption("4");
  await expect(page.locator(".actual-route")).toHaveAttribute(
    "data-route",
    "sequential-output",
  );
  await page.locator("#width").fill("512");
  await page.locator("#height").fill("512");
  await expect(page.locator(".actual-route")).toHaveAttribute(
    "data-route",
    "parallel",
  );
  await page.locator("#batch-preview-count").selectOption("2");
  await expect(page.locator(".vram-comparison.parallel")).toContainText(
    "2× physical batch",
  );
  await expect(page.locator("#image-count")).toHaveValue("4");
  await page.locator("#separate-jobs").check();
  await expect(page.locator(".actual-route")).toHaveAttribute(
    "data-route",
    "separate-jobs",
  );
  await page.locator("#request-preview").click();
  const data = JSON.parse(await page.locator(".json-preview").innerText());
  expect(data.input.num_images).toBe(4);
  for (const key of [
    "safetyGiB",
    "headroomGiB",
    "gpuGiB",
    "offload",
    "batchPreview",
  ])
    expect(data.input[key]).toBeUndefined();
});

test("CFG uses a 1–4 slider and preserves valid imported frozen-API values until the slider moves", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#prompt").fill("A test image");
  await expect(page.locator("#cfg")).toHaveAttribute("type", "range");
  await expect(page.locator("#cfg")).toHaveAttribute("min", "1");
  await expect(page.locator("#cfg")).toHaveAttribute("max", "4");
  await page.locator("#cfg").focus();
  await page.locator("#cfg").press("End");
  await expect(page.locator("#cfg-output")).toHaveText("4.0");
  await expect(page.locator("#negative-field")).toBeVisible();
  await page.locator("#request-preview").click();
  expect(
    JSON.parse(await page.locator(".json-preview").innerText()).input
      .true_cfg_scale,
  ).toBe(4);
  await page.locator("#content-dialog [data-close]").click();
  await page
    .locator("#json-upload")
    .setInputFiles({
      name: "old-request.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ input: { prompt: "Imported", true_cfg_scale: 8 } }),
      ),
    });
  await expect(page.locator("#cfg-output")).toHaveText("8");
  await expect(page.locator("#cfg-import-note")).toContainText("preserved");
  await page.locator("#request-preview").click();
  expect(
    JSON.parse(await page.locator(".json-preview").innerText()).input
      .true_cfg_scale,
  ).toBe(8);
  await page.locator("#content-dialog [data-close]").click();
  await page.locator("#cfg").focus();
  await page.locator("#cfg").press("Home");
  await expect(page.locator("#cfg-output")).toHaveText("1.0");
  await expect(page.locator("#cfg-import-note")).toBeHidden();
  await expect(page.locator("#negative-field")).toBeHidden();
});
