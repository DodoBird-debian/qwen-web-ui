import { test, expect, type Page } from "@playwright/test";

async function image(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    canvas.getContext("2d")!.fillRect(0, 0, 512, 512);
    return canvas.toDataURL().split(",")[1];
  });
}
async function paste(page: Page) {
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!)));
    const data = new DataTransfer();
    data.items.add(new File([blob], "pasted.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
}
async function addReference(page: Page) {
  await page.locator("#reference-upload").setInputFiles({
    name: "reference.png", mimeType: "image/png", buffer: Buffer.from(await image(page), "base64"),
  });
}
async function connect(page: Page) {
  await page.locator("#connection-open").click();
  await page.locator("#endpoint-id").fill("ui-test");
  await page.locator("#api-key").fill("fake-key");
  await page.locator("#connection-form button[type=submit]").click();
}

for (const [selector, extending] of [["[data-mode=inpaint]", false], ["#open-outpaint", true]] as const) {
  test(`pasting into empty ${extending ? "Outpaint" : "Inpaint"} loads a source, then additional pastes add references`, async ({ page }) => {
    await page.goto("/");
    await page.locator(selector).click();
    await expect(page.locator("#edit-empty-title")).toContainText(extending ? "extend" : "edit");
    await expect(page.locator("#generate-empty")).toBeHidden();
    await paste(page);
    await expect(page.locator("#canvas-viewport")).toBeVisible();
    await expect(page.locator("#references .reference-card")).toHaveCount(0);
    await expect(page.locator("#outpaint-enabled")).toBeChecked({ checked: extending });
    await paste(page);
    await expect(page.locator("#references .reference-card")).toHaveCount(1);
    await expect(page.locator("#references strong")).toHaveText("<image3>");
    await expect(page.locator("#outpaint-enabled")).toBeChecked({ checked: extending });
  });
}

test("Generate and Image edit pastes remain references; existing references can become an Outpaint source", async ({ page }) => {
  await page.goto("/");
  await paste(page);
  await expect(page.locator("#references .reference-card")).toHaveCount(1);
  await page.locator("[data-mode=edit]").click();
  await paste(page);
  await expect(page.locator("#references .reference-card")).toHaveCount(2);
  await page.locator("#match-source").click();
  await expect(page.locator("#width")).toHaveValue("512");
  await expect(page.locator("#height")).toHaveValue("512");
  await expect(page.locator("#canvas-viewport")).toBeHidden();
  await page.locator("#open-outpaint").click();
  await page.locator("#empty-choose").click();
  await page.locator(".source-picker button").first().click();
  await expect(page.locator("#canvas-viewport")).toBeVisible();
  await expect(page.locator("#outpaint-enabled")).toBeChecked();
  await expect(page.locator("#references .reference-card")).toHaveCount(2);
});

test("dropping on the empty edit canvas loads a source", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-mode=inpaint]").click();
  await page.locator("#empty-state").evaluate(async element => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!)));
    const data = new DataTransfer();
    data.items.add(new File([blob], "source.png", { type: "image/png" }));
    element.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator(".mask-layer")).toBeVisible();
  await expect(page.locator("#references .reference-card")).toHaveCount(0);
});

test("run controls have one owner, presets reflect edits, and enabling a negative prompt explicitly sets CFG", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#run-controls #image-count")).toHaveCount(1);
  await expect(page.locator("#settings #image-count, #settings #separate-jobs")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create 1 images", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Create 10 images", exact: true }).click();
  await expect(page.locator("#run-summary")).toContainText("4 + 4 + 2");
  await expect(page.getByRole("button", { name: "Create 10 images", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.locator("#run-options > summary").click();
  await page.locator("#series-total").fill("11");
  await expect(page.locator(".count-preset[aria-pressed=true]")).toHaveCount(0);
  await page.locator("#negative-enable").click();
  await expect(page.locator("#cfg")).toHaveValue("2");
  await expect(page.locator("#negative-prompt")).toBeFocused();
  await page.locator("#negative-prompt").fill("blurred");
  await page.locator("#reset-settings").click();
  await expect(page.locator("#negative-field")).toBeHidden();
  await page.locator("#negative-enable").click();
  await expect(page.locator("#negative-prompt")).toHaveValue("blurred");
});

test("prompt variants validate reference tags and submit one image per prompt with a shared seed", async ({ page }) => {
  await page.goto("/");
  const png = await image(page);
  const requests: { prompt: string; seed: number; num_images: number; images: string[] }[] = [];
  await page.route("**/api/runpod/**", route => {
    if (route.request().url().endsWith("/run")) {
      requests.push(route.request().postDataJSON().input);
      return route.fulfill({ json: { id: `variant-${requests.length}`, status: "IN_QUEUE" } });
    }
    return route.fulfill({ json: { id: `variant-${requests.length}`, status: "COMPLETED",
      output: { images: [{ image_base64: png, mime_type: "image/png", width: 512, height: 512, seed: 100 }] },
    } });
  });
  await connect(page);
  await addReference(page);
  await page.locator("#width").fill("512");
  await page.locator("#height").fill("512");
  await page.locator("#seed").fill("100");
  await expect(page.locator("#run-kind")).toBeHidden();
  await page.locator("#run-options > summary").click();
  await page.locator("#run-kind").selectOption("variants");
  await page.locator("#prompt-variants").fill("Warm | Warm light on <image2>\nCool | Cool light on <image1>");
  await expect(page.locator("#validation")).toContainText("<image2> has no attached reference image");
  await expect(page.locator("#generate")).toBeDisabled();
  await page.locator("#prompt-variants").fill("Warm | Warm light on <image1>\nCool | Cool light on <image1>");
  await expect(page.locator("#composer-run-summary")).toContainText("2 images · 2 requests");
  await page.locator("#generate").click();
  await expect(page.locator("#run-progress")).toContainText("completed · 2 / 2");
  expect(requests.map(({ prompt, seed, num_images, images }) => [prompt, seed, num_images, images.length])).toEqual([
    ["Warm light on <image1>", 100, 1, 1],
    ["Cool light on <image1>", 100, 1, 1],
  ]);
});

test("Generate shortcut uses submission guards, terminal activity unsticks, and history/export stay usable", async ({ page }) => {
  await page.goto("/");
  const png = await image(page);
  let posts = 0, done = false;
  await page.route("**/api/runpod/**", route => {
    const submit = route.request().url().endsWith("/run");
    if (submit) posts++;
    return route.fulfill({ json: { id: "shortcuts", status: submit ? "IN_QUEUE" : done ? "COMPLETED" : "IN_PROGRESS",
      ...(done ? { output: { images: [{ image_base64: png, mime_type: "image/png", width: 512, height: 512, seed: 100 }] } } : {}) } });
  });
  await expect(page.locator(".composer #validation")).toContainText("prompt");
  await expect(page.locator("#generate")).toHaveAttribute("aria-describedby", "validation");
  await page.locator("#prompt").press("Control+Enter");
  expect(posts).toBe(0);
  await connect(page);
  await page.locator("#prompt").fill("A vase");
  await page.locator("#width").fill("512");
  await page.locator("#height").fill("512");
  await page.locator("#seed").fill("100");
  await page.locator("#prompt").press("Control+Enter");
  await expect(page.locator("#generation-activity")).toHaveCSS("position", "sticky");
  await page.locator("#prompt").press("Control+Enter");
  await page.locator("#prompt").press("Meta+Enter");
  expect(posts).toBe(1);
  done = true;
  await expect(page.locator("#generation-state")).toHaveText("Generation completed");
  await expect(page.locator("#generation-activity")).toHaveCSS("position", "relative");
  await page.locator("#history-toggle").click();
  await expect(page.locator("#image-history-content")).toBeHidden();
  await expect(page.locator("#history-toggle")).toHaveAttribute("aria-expanded", "false");
  await page.locator("#history-toggle").click();
  await expect(page.locator(".image-history-card")).toBeVisible();
  await page.getByRole("button", { name: "Export raw", exact: true }).click();
  const dialog = page.locator(".export-dialog");
  await expect(dialog.getByRole("button", { name: "Download export", exact: true })).toBeEnabled();
  await dialog.locator("[data-format]").selectOption("webp");
  await expect(dialog.locator(".notice")).toContainText("image/webp");
  await expect(dialog.getByRole("button", { name: "Download export", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator("[data-mode=inpaint]").click();
  await page.locator("#empty-choose").click();
  await page.locator(".source-picker button").click();
  await expect(page.locator(".mask-layer")).toBeVisible();
  expect(posts).toBe(1);
});

test("editor shortcuts preserve text undo, mask focus, stroke geometry, and zoom-scaled cursor", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Alt+3");
  await paste(page);
  const mask = page.locator(".mask-layer");
  await mask.scrollIntoViewIfNeeded();
  const box = (await mask.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const alpha = () => page.locator(".mask-layer").evaluate((c: HTMLCanvasElement) => c.getContext("2d")!.getImageData(256, 256, 1, 1).data[3]);
  expect(await alpha()).toBe(255);
  await page.keyboard.press("Control+z");
  expect(await alpha()).toBe(0);
  await expect(mask).toBeFocused();
  await page.keyboard.press("Control+Shift+z");
  expect(await alpha()).toBe(255);
  await page.keyboard.press("e");
  await expect(page.locator("[data-tool=erase]")).toHaveClass(/active/);
  await page.keyboard.press("b");
  await page.keyboard.press("]");
  await expect(page.locator("#brush-size")).toHaveValue("70");
  await expect(page.locator(".brush-cursor")).toBeVisible();
  const diameter = (await page.locator(".brush-cursor").boundingBox())!.width;
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect.poll(async () => (await page.locator(".brush-cursor").boundingBox())?.width || 0).toBeGreaterThan(diameter);
  const zoomed = (await mask.boundingBox())!;
  await page.mouse.click(zoomed.x + zoomed.width / 4, zoomed.y + zoomed.height / 4);
  expect(await mask.evaluate((c: HTMLCanvasElement) => c.getContext("2d")!.getImageData(128, 128, 1, 1).data[3])).toBe(255);
  await page.keyboard.down("Space");
  await expect(page.locator("#canvas-viewport")).toHaveClass(/canvas-panning/);
  await page.keyboard.up("Space");
  await expect(page.locator("#canvas-viewport")).not.toHaveClass(/canvas-panning/);
  await page.locator("#canvas-zoom").selectOption("4");
  await page.locator("#canvas-viewport").evaluate(element => { element.scrollLeft = 120; });
  await mask.evaluate((element: HTMLCanvasElement) => element.focus({ preventScroll: true }));
  const viewport = (await page.locator("#canvas-viewport").boundingBox())!;
  const beforePan = await page.locator("#canvas-viewport").evaluate(element => element.scrollLeft);
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + 100);
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(viewport.x + viewport.width / 2 + 40, viewport.y + 100);
  await page.mouse.up();
  await page.keyboard.up("Space");
  expect(await page.locator("#canvas-viewport").evaluate(element => element.scrollLeft)).toBeLessThan(beforePan);
  await page.locator("#prompt").fill("Edit");
  await page.locator("#prompt").press("End");
  await page.keyboard.type(" blue");
  await page.keyboard.press("Control+z");
  await expect(page.locator("#prompt")).toHaveValue("Edit");
  expect(await alpha()).toBe(255);
  await page.locator("#prompt").press("e");
  await expect(page.locator("[data-tool=brush]")).toHaveClass(/active/);
});

test("reference preparation automatically refreshes and never applies stale settings", async ({ page }) => {
  await page.goto("/");
  await addReference(page);
  await page.getByLabel("More actions for reference 1").click();
  await page.getByRole("button", { name: "Resize / encode", exact: true }).click();
  const apply = page.getByRole("button", { name: "Apply prepared image", exact: true });
  await expect(apply).toBeEnabled();
  const disabledImmediately = await page.locator("#compress-size").evaluate((input: HTMLInputElement) => {
    input.value = "128";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return document.querySelector<HTMLButtonElement>("#content-body .generate-button")!.disabled;
  });
  expect(disabledImmediately).toBe(true);
  await page.locator("#compress-size").fill("256");
  await expect(page.locator("#content-body .notice")).toContainText("→ 256×256");
  await expect(apply).toBeEnabled();
  await page.locator("#compress-size").fill("0");
  await expect(page.locator("#content-body .notice")).toContainText("valid side");
  await expect(apply).toBeDisabled();
  await page.locator("#compress-size").fill("128");
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.locator("#references .reference-info")).toContainText("128×128");
});

test("shortcuts ignore dialogs and composition, and Generate commits a focused region instruction", async ({ page }) => {
  await page.goto("/");
  const requests: { input: { prompt: string } }[] = [];
  await page.route("**/api/runpod/**", route => {
    if (route.request().url().endsWith("/run")) requests.push(JSON.parse(route.request().postData()!));
    return route.fulfill({ json: { id: "region-shortcut", status: "IN_PROGRESS" } });
  });
  await connect(page);
  await page.locator("[data-mode=inpaint]").click();
  await paste(page);
  const mask = page.locator(".mask-layer");
  await mask.scrollIntoViewIfNeeded();
  const box = (await mask.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator("#prompt").fill("Change this patch");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#connection-open").click();
  await page.locator("#endpoint-id").press("Control+Enter");
  expect(requests).toHaveLength(0);
  await page.locator("#connection-dialog [data-close]").click();
  await page.locator("#prompt").evaluate(input => input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true, bubbles: true, cancelable: true }),
  ));
  expect(requests).toHaveLength(0);
  await page.locator("#prompt").press("Alt+4");
  await expect(page.locator("[data-mode=inpaint]")).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Region 1 instruction").fill("Turn this patch orange");
  await page.getByLabel("Region 1 instruction").press("Control+Enter");
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].input.prompt).toContain("Turn this patch orange");
});

test("editor panels split only with enough workspace width and mobile navigation tracks sections", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.goto("/");
  await page.locator("#open-outpaint").click();
  await paste(page);
  await expect(page.locator("#outpaint-size")).toContainText("Final canvas");
  await expect(page.locator("#run-summary")).toContainText("request");
  const canvas = page.locator("#canvas-area"), panels = page.locator("#edit-panels");
  await expect.poll(async () => Math.abs((await canvas.boundingBox())!.y - (await panels.boundingBox())!.y)).toBeLessThan(2);
  await page.screenshot({ path: "/tmp/qwen-ui-editor-wide.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(async () => (await panels.boundingBox())!.y - (await canvas.boundingBox())!.y).toBeGreaterThan(250);
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Workspace sections" });
  await nav.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(nav.getByRole("button", { name: "Settings", exact: true })).toHaveAttribute("aria-current", "location");
  await nav.getByRole("button", { name: /References/ }).click();
  await expect(nav.getByRole("button", { name: /References/ })).toHaveAttribute("aria-current", "location");
  await addReference(page);
  await expect(nav.getByRole("button", { name: "References (1)", exact: true })).toBeVisible();
  for (const width of [360, 390, 844]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await nav.getByRole("button", { name: "Workspace", exact: true }).click();
  await page.screenshot({ path: "/tmp/qwen-ui-editor-mobile.png", fullPage: true });
});
