import { expect, test, type Page } from "@playwright/test";

async function savedFixture(page: Page, kind: "completed" | "inpaint" | "projects") {
  return page.evaluate(async (kind) => {
    const storage = "/src/storage/db.ts";
    const contract = "/src/api/contract.ts";
    const { put, setPersistence } = await import(storage);
    const { DEFAULTS } = await import(contract);
    localStorage.setItem("qwen-storage-enabled", "true");
    await setPersistence(true);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    canvas.getContext("2d")!.fillRect(32, 32, 64, 64);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((image) => resolve(image!)));
    const input = { ...DEFAULTS, prompt: "Saved prompt", width: 256, height: 256, seed: "41" };
    const job = { id: "fixture:job", endpoint: "fixture", runpodId: "job", created: 123, input };
    if (kind === "projects") {
      const project = { created: 123, input, references: [], crop: false, padding: "32", feather: "0", instruction: "" };
      await put("projects", { ...project, id: "A", title: "Project A", mode: "inpaint", source: blob, mask: blob });
      await put("projects", { ...project, id: "B", title: "Project B", mode: "generate" });
    } else if (kind === "inpaint") {
      const geometry = "/src/editor/geometry.ts";
      const { transformFor } = await import(geometry);
      await put("jobs", {
        ...job, status: "IN_PROGRESS",
        inpaint: { source: blob, mask: blob, transform: transformFor(256, 256, 256, 256, null, 0) },
      });
      sessionStorage.setItem("qwen-pending-submission", JSON.stringify({ endpoint: "fixture", id: "job", created: 123 }));
    } else {
      await put("jobs", {
        ...job, status: "COMPLETED",
        results: [{ blob, width: 256, height: 256, mime: "image/png", seed: "41" }],
      });
    }
    return canvas.toDataURL("image/png").split(",")[1];
  }, kind);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/config.json", (route) => route.fulfill({ json: { endpointId: "fixture", serverAuth: true } }));
  await page.goto("/");
  await expect(page.locator("#connection-label")).toHaveText("fixture");
});

test("manual resume shows a completed local image without polling or replacing it", async ({ page }) => {
  let polls = 0;
  await page.route("**/api/runpod/**", (route) => {
    polls++;
    return route.fulfill({ status: 404, json: {} });
  });
  await savedFixture(page, "completed");
  await page.locator("#history-open").click();
  await page.locator("#manual-job-id").fill("job");
  await page.getByRole("button", { name: "Resume polling" }).click();
  await expect(page.locator(".result-seed")).toHaveText("Seed 41");
  expect(polls).toBe(0);
  const saved = await page.evaluate(async () => {
    const storage = "/src/storage/indexeddb.ts";
    const disk = await import(storage);
    // Emulate a late expiry update from a different tab.
    await disk.put("jobs", { id: "fixture:job", status: "EXPIRED", created: Date.now() });
    const record = await disk.get("jobs", "fixture:job");
    return [record.status, record.input.prompt, record.results.length, record.created];
  });
  expect(saved).toEqual(["COMPLETED", "Saved prompt", 1, 123]);
});

test("resuming a saved inpaint job after reload creates the local composite", async ({ page }) => {
  const png = await savedFixture(page, "inpaint");
  await page.route("**/api/runpod/**", (route) => route.fulfill({
    json: { id: "job", status: "COMPLETED", output: { images: [
      { image_base64: png, mime_type: "image/png", width: 256, height: 256, seed: 41 },
    ] } },
  }));
  await page.reload();
  await page.locator("#check-generation").click();
  await expect(page.locator(".result-heading strong")).toHaveText("Local composite");
  await expect.poll(() => page.evaluate(async () => {
    const storage = "/src/storage/indexeddb.ts";
    const { get } = await import(storage);
    const record = await get("jobs", "fixture:job");
    return [record.input.prompt, !!record.inpaint, !!record.results?.[0]?.composite];
  })).toEqual(["Saved prompt", true, true]);
});

test("a series preview shows each batch and importing one image resets the planner", async ({ page }) => {
  const requests: number[] = [];
  await page.route("**/api/runpod/**", (route) => {
    if (route.request().method() === "POST") {
      requests.push(route.request().postDataJSON().input.num_images);
      return route.fulfill({ json: { id: "job", status: "IN_QUEUE" } });
    }
    return route.fulfill({ json: { id: "job", status: "CANCELLED" } });
  });
  await page.locator("#prompt").fill("A preview");
  await page.locator("#seed").fill("41");
  await page.locator("#separate-jobs").check();
  await page.locator("#run-kind").selectOption("series");
  await page.locator("#series-total").fill("8");
  await page.locator("#request-preview").click();
  const dialog = page.locator("#content-dialog");
  await expect(dialog).toContainText("8 images across 2 requests");
  await expect(dialog.locator(".json-preview")).toContainText('"num_images": 4');
  await dialog.locator("select").selectOption("1");
  await expect(dialog.locator(".json-preview")).toContainText('"seed": 45');
  await page.keyboard.press("Escape");
  await page.locator("#json-upload").setInputFiles({
    name: "one.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ input: { prompt: "Imported", num_images: 1, seed: 41 } })),
  });
  await expect(page.locator("#run-kind")).toHaveValue("single");
  await expect(page.locator("#separate-jobs")).not.toBeChecked();
  await page.locator("#generate").click();
  await expect(page.locator("#job-status")).toContainText("CANCELLED");
  expect(requests).toEqual([1]);
});

test("saving a text project after an inpaint project leaves its editor empty", async ({ page }) => {
  await savedFixture(page, "projects");
  const dialog = page.locator("#content-dialog");
  for (const title of ["Project A", "Project B"]) {
    await page.locator("#project-open").click();
    await dialog.locator("article").filter({ hasText: title }).getByRole("button", { name: "Open" }).click();
    await expect(dialog).not.toBeVisible();
  }
  await page.locator("#save-project").click();
  await expect(page.locator("#toast")).toContainText("Project saved");
  expect(await page.evaluate(async () => {
    const storage = "/src/storage/indexeddb.ts";
    const { get } = await import(storage);
    const record = await get("projects", "B");
    return [record.mode, !!record.source, !!record.mask, !!record.regions];
  })).toEqual(["generate", false, false, false]);
});

test("a corrupt image does not discard later valid images in the same response", async ({ page }) => {
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const image = { image_base64: png, mime_type: "image/png", width: 256, height: 256 };
  let submissions = 0;
  await page.route("**/api/runpod/**", (route) => {
    if (route.request().method() === "POST") {
      submissions++;
      return route.fulfill({ json: { id: "mixed", status: "IN_QUEUE" } });
    }
    return route.fulfill({ json: { id: "mixed", status: "COMPLETED", output: { images: [
      { ...image, seed: 41 },
      { ...image, seed: 42, width: 512 },
      { ...image, seed: 43 },
    ] } } });
  });
  await page.locator("#persist-browser").check();
  await expect(page.locator("#storage-mode-note")).toContainText("Saved in this browser");
  await page.locator("#prompt").fill("Three images");
  await page.locator("#seed").fill("41");
  await page.locator("#image-count").selectOption("3");
  await page.locator("#generate").click();
  await expect(page.locator(".result-seed")).toHaveText(["Seed 41", "Seed 43"]);
  await expect(page.locator(".delivery-notice")).toContainText("Returned 2 of 3");
  await expect(page.locator(".delivery-notice")).toContainText("Image 2");
  await page.reload();
  await page.locator('[data-history-job="mixed"]').click();
  await expect(page.locator(".result-seed")).toHaveText(["Seed 41", "Seed 43"]);
  expect(submissions).toBe(1);
});

for (const outpaint of [false, true]) {
  test(`seed reuse preserves the saved ${outpaint ? "outpaint placement" : "cropped inpaint mask"}`, async ({ page }) => {
    await page.locator("#persist-browser").check();
    await expect(page.locator("#storage-mode-note")).toContainText("Saved in this browser");
    const fixture = await page.evaluate(async (outpaint) => {
      const storage = "/src/storage/db.ts";
      const geometry = "/src/editor/geometry.ts";
      const contract = "/src/api/contract.ts";
      const { put } = await import(storage);
      const { transformFor } = await import(geometry);
      const { DEFAULTS } = await import(contract);
      const canvas = document.createElement("canvas");
      canvas.width = outpaint ? 384 : 256;
      canvas.height = 256;
      const context = canvas.getContext("2d")!;
      const asBlob = () => new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!)));
      context.fillStyle = "#204060";
      context.fillRect(0, 0, 256, 256);
      const source = await asBlob();
      const bounds = outpaint
        ? { x: 256, y: 0, width: 128, height: 256 }
        : { x: 96, y: 64, width: 96, height: 128 };
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
      const mask = await asBlob();
      const transform = transformFor(canvas.width, canvas.height, 256, 256, outpaint ? null : bounds, 0);
      const placement = outpaint ? { x: 0, y: 0, width: 256, height: 256 } : undefined;
      const guides = [canvas.toDataURL().split(",")[1]];
      canvas.width = canvas.height = 256;
      context.fillStyle = "#cc5500";
      context.fillRect(0, 0, 256, 256);
      const png = canvas.toDataURL().split(",")[1];
      guides.push(png);
      const blob = await asBlob();
      const input = { ...DEFAULTS, prompt: "Edit <image1> with <image2>", width: 256, height: 256, seed: "41", images: guides };
      await put("jobs", {
        id: "fixture:saved-edit", endpoint: "fixture", runpodId: "saved-edit", created: 123, status: "COMPLETED",
        input, inpaint: { source, mask, transform, placement },
        results: [{ blob, composite: source, width: 256, height: 256, mime: "image/png", seed: "41" }],
      });
      return { png, input, placement };
    }, outpaint);
    let submitted;
    await page.route("**/api/runpod/**", (route) => {
      if (route.request().method() === "POST") {
        submitted = route.request().postDataJSON().input;
        return route.fulfill({ json: { id: "reused", status: "IN_QUEUE" } });
      }
      return route.fulfill({ json: { id: "reused", status: "COMPLETED", output: { images: [
        { image_base64: fixture.png, mime_type: "image/png", width: 256, height: 256, seed: 41 },
      ] } } });
    });
    await page.locator("#history-open").click();
    await page.getByRole("button", { name: "View results", exact: true }).click();
    await page.getByRole("button", { name: "Reuse seed", exact: true }).click();
    await expect(page.locator("#reused-inpaint")).toContainText("will apply the saved mask");
    await page.locator("#width").fill("288");
    await expect(page.locator("#reused-inpaint")).toContainText("will return a raw image");
    await page.locator("#width").fill("256");
    await expect(page.locator("#reused-inpaint")).toContainText("will apply the saved mask");
    if (outpaint) {
      await page.locator("#save-project").click();
      await expect(page.locator("#toast")).toContainText("Project saved");
      await page.reload();
      await page.locator("#project-open").click();
      await page.getByRole("button", { name: "Open", exact: true }).click();
      await expect(page.locator("#reused-inpaint")).toContainText("will apply the saved mask");
    }
    await page.locator("#generate").click();
    await expect(page.locator("#job-status")).toContainText("Completed · reused");
    expect(submitted).toMatchObject({ ...fixture.input, seed: 41 });
    const pixels = await page.locator(".composite-variant img").evaluate(async (element: HTMLImageElement, outpaint) => {
      await element.decode();
      const canvas = document.createElement("canvas");
      canvas.width = element.naturalWidth;
      canvas.height = element.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(element, 0, 0);
      return {
        width: canvas.width,
        original: Array.from(ctx.getImageData(12, 12, 1, 1).data),
        edited: Array.from(ctx.getImageData(outpaint ? 320 : 120, 120, 1, 1).data),
      };
    }, outpaint);
    expect(pixels).toEqual({
      width: outpaint ? 384 : 256,
      original: [32, 64, 96, 255],
      edited: [204, 85, 0, 255],
    });
    expect(await page.evaluate(async () => {
      const storage = "/src/storage/indexeddb.ts";
      const { get } = await import(storage);
      const record = await get("jobs", "fixture:reused");
      return record?.inpaint?.placement;
    })).toEqual(fixture.placement);
  });
}

async function pngFile(page: Page, name: string, color: string, size = 512) {
  const png = await page.evaluate(({ color, size }) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d")!;
    context.fillStyle = color;
    context.fillRect(0, 0, size, size);
    return canvas.toDataURL().split(",")[1];
  }, { color, size });
  return { name, mimeType: "image/png", buffer: Buffer.from(png, "base64") };
}
async function holdFileRead(page: Page, filename: string) {
  await page.evaluate(name => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      if (this.name === name) await new Promise<void>(resolve => {
        Object.assign(window, { finishFixtureRead: resolve });
      });
      return original.call(this);
    };
  }, filename);
}
async function releaseFileRead(page: Page) {
  await page.evaluate(() => (window as any).finishFixtureRead());
}
async function inpaintCanvas(page: Page) {
  await page.locator("[data-mode=inpaint]").click();
  await page.locator("#source-upload").setInputFiles(await pngFile(page, "source.png", "#208040"));
  const mask = page.locator(".mask-layer");
  await mask.scrollIntoViewIfNeeded();
  return mask;
}
async function paintCenter(page: Page) {
  const mask = page.locator(".mask-layer");
  await mask.scrollIntoViewIfNeeded();
  const box = (await mask.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
const centerAlpha = (page: Page) => page.locator(".mask-layer").evaluate(
  (c: HTMLCanvasElement) => c.getContext("2d")!.getImageData(c.width / 2, c.height / 2, 1, 1).data[3],
);

test("a slow source selection cannot replace the newer source or its painted mask", async ({ page }) => {
  await page.locator("[data-mode=inpaint]").click();
  const input = page.locator("#source-upload");
  const source = page.locator(".canvas-stage > canvas").first();
  const color = () => source.evaluate((c: HTMLCanvasElement) =>
    Array.from(c.getContext("2d")!.getImageData(0, 0, 1, 1).data));
  await holdFileRead(page, "slow.png");
  await input.setInputFiles(await pngFile(page, "slow.png", "red"));
  await page.waitForFunction(() => !!(window as any).finishFixtureRead);
  await input.setInputFiles(await pngFile(page, "new.png", "blue"));
  await expect.poll(color).toEqual([0, 0, 255, 255]);
  await page.locator(".mask-layer").scrollIntoViewIfNeeded();
  await paintCenter(page);
  await releaseFileRead(page);
  await expect.poll(async () => [await color(), await centerAlpha(page)]).toEqual([[0, 0, 255, 255], 255]);
  // Allow the delayed upload to pass through all bitmap decoding, then recheck.
  await page.waitForTimeout(250);
  expect(await color()).toEqual([0, 0, 255, 255]);
  expect(await centerAlpha(page)).toBe(255);
});

test("an imported mask stays with the region selected when the import started", async ({ page }) => {
  await inpaintCanvas(page);
  await page.getByRole("button", { name: "+ Region" }).click();
  const regions = page.locator(".region-select");
  await regions.nth(0).click();
  await holdFileRead(page, "slow-mask.png");
  await page.locator("#mask-upload").setInputFiles(await pngFile(page, "slow-mask.png", "white"));
  await page.waitForFunction(() => !!(window as any).finishFixtureRead);
  await regions.nth(1).click();
  await releaseFileRead(page);
  await expect(page.locator("#mask-upload")).toHaveValue("");
  expect(await centerAlpha(page)).toBe(0);
  await regions.nth(0).click();
  expect(await centerAlpha(page)).toBe(255);
});

test("region instructions retain their reserved source tag across a mode round trip", async ({ page }) => {
  await inpaintCanvas(page);
  await page.locator("#prompt").fill("Preserve the shape");
  await paintCenter(page);
  const instruction = page.getByLabel("Region 1 instruction");
  const text = "Match the object in <image1>.";
  await instruction.fill(text);
  await instruction.press("Tab");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("[data-mode=generate]").click();
  await page.locator("[data-mode=inpaint]").click();
  await expect(instruction).toHaveValue(text);
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#request-preview").click();
  await expect(page.locator(".json-preview")).toContainText(text);
});

test("one-cell comparison export matches preview and the outgoing frozen request", async ({ page }) => {
  let submitted = "";
  await page.route("**/api/runpod/**", async route => {
    if (route.request().method() === "POST") submitted = route.request().postData()!;
    await route.fulfill({ json: { id: "export", status: "FAILED", error: "fixture" } });
  });
  await page.locator("#prompt").fill("An elm");
  await page.locator("#seed").fill("41");
  await page.locator("#run-kind").selectOption("grid");
  await page.locator("#grid-x").selectOption("seed");
  await page.locator("#grid-x-values").fill("123");
  await page.locator("#grid-y").selectOption("none");
  await page.locator("#request-preview").click();
  await expect(page.locator(".json-preview")).toContainText('"seed": 123');
  await page.keyboard.press("Escape");
  const [file] = await Promise.all([page.waitForEvent("download"), page.locator("#export-request").click()]);
  const { readFile } = await import("node:fs/promises");
  const payload = await readFile((await file.path())!, "utf8");
  expect(JSON.parse(payload).input.seed).toBe(123);
  await page.locator("#generate").click();
  await expect.poll(() => submitted).toBe(payload);
});

test("a multi-request JSON export downloads each prepared batch independently", async ({ page }) => {
  await page.locator("#prompt").fill("A five-image series");
  await page.locator("#seed").fill("41");
  await page.locator("#run-kind").selectOption("series");
  await page.locator("#series-total").fill("5");
  await page.locator("#export-request").click();
  await expect(page.getByRole("heading", { name: "Export a planned request" })).toBeVisible();
  const { readFile } = await import("node:fs/promises");
  for (const [index, count, seed] of [[1, 4, 41], [2, 1, 45]]) {
    const button = page.getByRole("button", { name: new RegExp("Download request " + index) });
    const [file] = await Promise.all([page.waitForEvent("download"), button.click()]);
    const { input } = JSON.parse(await readFile((await file.path())!, "utf8"));
    expect(input).toMatchObject({ num_images: count, seed });
  }
});

test("saving an empty key uses the server default and an explicit new key overrides it", async ({ page }) => {
  const overrides: (string | undefined)[] = [];
  await page.route("**/api/runpod/**/health", route => {
    overrides.push(route.request().headers()["x-runpod-api-key"]);
    return route.fulfill({ json: { workers: { ready: 1 } } });
  });
  const open = page.locator("#connection-open"), save = page.locator("#connection-form button[type=submit]");
  const check = page.locator("#connection-test"), key = page.locator("#api-key");
  await open.click();
  await key.fill("test-old-key");
  await save.click();
  await open.click();
  await expect(key).toHaveValue("");
  await save.click();
  await open.click();
  await check.click();
  await expect.poll(() => overrides.length).toBe(1);
  await key.fill("test-new-key");
  await save.click();
  await open.click();
  await key.fill("test-new-key");
  await check.click();
  await expect.poll(() => overrides).toEqual([undefined, "test-new-key"]);
});

test("Find uses selects a literal reference alias and the request compiles its tag", async ({ page }) => {
  await page.locator("#reference-upload").setInputFiles(await pngFile(page, "vase.png", "pink"));
  await page.getByLabel("Reference 1 alias").fill("vase");
  await page.getByLabel("Reference 1 alias").press("Tab");
  await page.locator("#prompt").fill("Use @{vase}");
  await expect(page.locator("[data-reference-uses]")).toHaveText("1 prompt uses");
  await page.getByLabel("More actions for reference 1").click();
  await page.getByRole("button", { name: "Find uses" }).click();
  expect(await page.locator("#prompt").evaluate((t: HTMLTextAreaElement) =>
    t.value.slice(t.selectionStart, t.selectionEnd))).toBe("@{vase}");
  await page.locator("#request-preview").click();
  await expect(page.locator(".json-preview")).toContainText("Use <image1>");
});

test("a leading zero is normalized and the first click after editing the series total submits", async ({ page }) => {
  let body: { seed: number; num_images: number } | undefined;
  await page.route("**/api/runpod/**", async route => {
    if (route.request().method() === "POST") body = route.request().postDataJSON().input;
    await route.fulfill({ json: { id: "seed", status: "FAILED", error: "fixture" } });
  });
  await page.locator("#prompt").fill("An elm");
  await page.locator("#seed").fill("0041");
  await page.locator("#run-kind").selectOption("series");
  await page.locator("#series-total").fill("2");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect.poll(() => body).toMatchObject({ seed: 41, num_images: 2 });
  await expect(page.locator("#job-status")).toContainText("seed");
  await page.locator("#series-total").fill("0");
  await expect(page.locator("#generate")).toBeDisabled();
});

test("a text-only request import discards the old outpaint canvas before project capture", async ({ page }) => {
  await inpaintCanvas(page);
  await paintCenter(page);
  await page.locator("#outpaint-enabled").check();
  await page.locator("#extend-left").fill("32");
  await page.locator("#json-upload").setInputFiles({ name: "request.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ input: { prompt: "A blank canvas" } })) });
  await expect(page.locator("#prompt")).toHaveValue("A blank canvas");
  await page.locator("#save-project").click();
  await expect(page.locator("#toast")).toContainText("Project saved");
  expect(await page.evaluate(async () => {
    const mod = "/src/storage/db.ts";
    const { list } = await import(mod);
    const [project] = await list("projects");
    return [project.mode, project.input.prompt, project.source, project.regions, project.expansion];
  })).toEqual(["generate", "A blank canvas", undefined, undefined, undefined]);
});

test("re-enabling persistence keeps a newer project from another tab and migrates session-only work", async ({ page, context }) => {
  await page.locator("#persist-browser").check();
  await expect(page.locator("#storage-mode-note")).toContainText("Saved in this browser");
  await page.locator("#prompt").fill("First revision");
  await page.locator("#save-project").click();
  await expect(page.locator("#toast")).toContainText("Project saved");
  const other = await context.newPage();
  await other.route("**/config.json", route => route.fulfill({ json: { endpointId: "fixture", serverAuth: true } }));
  await other.goto("/");
  await other.locator("#project-open").click();
  await other.locator(".history-item").filter({ hasText: "First revision" }).getByRole("button", { name: "Open" }).click();
  await other.locator("#prompt").fill("Cross-tab revision");
  await other.locator("#save-project").click();
  await expect(other.locator("#toast")).toContainText("Project saved");
  await page.locator("#persist-browser").uncheck();
  await expect(page.locator("#storage-mode-note")).toContainText("Session only");
  await page.evaluate(async () => {
    const storage = "/src/storage/db.ts";
    const { put } = await import(storage);
    await put("projects", { id: "session-only", created: Date.now(), title: "Session-only project" });
  });
  await page.locator("#persist-browser").check();
  await expect(page.locator("#toast")).toContainText("Browser persistence enabled");
  await other.reload();
  await other.locator("#project-open").click();
  await expect(other.locator(".history-item").filter({ hasText: "Cross-tab revision" })).toHaveCount(1);
  await expect(other.locator(".history-item").filter({ hasText: "First revision" })).toHaveCount(0);
  await expect(other.locator(".history-item").filter({ hasText: "Session-only project" })).toHaveCount(1);
});

async function runReturnedImage(page: Page, png: string, size: number) {
  let index = 0, outputs: number[] = [];
  await page.route("**/api/runpod/**", async route => {
    const req = route.request();
    const id = req.url().split("/").at(-1);
    if (id === "run") {
      const input = req.postDataJSON().input;
      outputs = Array.from({ length: input.num_images }, (_, i) => input.seed + i);
      return route.fulfill({ json: { id: "job-" + ++index, status: "IN_QUEUE" } });
    }
    const seeds = id === "unrelated" ? [82] : outputs;
    await route.fulfill({ json: { id, status: "COMPLETED", output: { images: seeds.map(seed => ({
      image_base64: png, width: size, height: size, seed, mime_type: "image/png",
    })) } } });
  });
}

test("recovering an unrelated job replaces the displayed series and exports only that job", async ({ page }) => {
  await runReturnedImage(page, (await pngFile(page, "orange.png", "orange", 256)).buffer.toString("base64"), 256);
  await page.locator("#prompt").fill("A series");
  await page.locator("#seed").fill("41");
  await page.locator("#run-kind").selectOption("series");
  await page.locator("#series-total").fill("2");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator(".result-seed")).toHaveText(["Seed 41", "Seed 42"]);
  await page.locator("#history-open").click();
  await page.locator("#manual-job-id").fill("unrelated");
  await page.getByRole("button", { name: "Resume polling" }).click();
  await expect(page.locator("#job-status")).toContainText("Completed · unrelated");
  await expect(page.locator(".result-seed")).toHaveText("Seed 82");
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download selected ZIP" }).click()]);
  const { readFile } = await import("node:fs/promises");
  const { unzipSync, strFromU8 } = await import("fflate");
  const zip = unzipSync(await readFile((await file.path())!));
  expect(JSON.parse(strFromU8(zip["manifest.json"])).images.map((i: any) => i.metadata.seed)).toEqual(["82"]);
});

test("inspector maps a proportionally reduced raw image to the same source pixels as the composite", async ({ page }) => {
  await inpaintCanvas(page);
  await paintCenter(page);
  await page.locator("#crop-mask").uncheck();
  await page.locator("#width").fill("256");
  await page.locator("#height").fill("256");
  await page.locator("#seed").fill("41");
  await page.locator("#prompt").fill("Fill the center with orange");
  await runReturnedImage(page, (await pngFile(page, "orange.png", "orange", 128)).buffer.toString("base64"), 128);
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator(".composite-variant img")).toBeVisible();
  const compositeColor = await page.locator(".composite-variant img").evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 256, 256, 1, 1, 0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  });
  expect(compositeColor).toEqual([255, 165, 0, 255]);
  await page.getByRole("button", { name: "Inspect raw", exact: true }).click();
  const viewer = page.locator(".inspector");
  await viewer.getByRole("combobox", { name: "View", exact: true }).selectOption("side");
  const canvas = viewer.locator(".inspection-stage canvas");
  await expect(canvas).toHaveJSProperty("width", 1024);
  const aligned = await canvas.evaluate((c: HTMLCanvasElement) =>
    [...c.getContext("2d")!.getImageData(512 + 256, 256, 1, 1).data]);
  expect(aligned).toEqual(compositeColor);
  await viewer.getByRole("combobox", { name: "View", exact: true }).selectOption("difference");
  await expect(canvas).toHaveJSProperty("width", 512);
});

test("history migrates legacy media, pages the list and reads heavy data only when using a job", async ({ page }) => {
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const img = canvas.toDataURL().split(",")[1];
    const contract = "/src/api/contract.ts";
    const { DEFAULTS } = await import(contract);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("qwen-image-studio", 2);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("projects", { keyPath: "id" });
        request.result.createObjectStore("jobs", { keyPath: "id" }).createIndex("status-created", ["status", "created"]);
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction("jobs", "readwrite"), jobs = tx.objectStore("jobs");
        for (let n = 0; n < 32; n++) jobs.put({
          id: "fixture:history-" + n, runpodId: "history-" + n, endpoint: "fixture",
          created: n, status: "COMPLETED",
          input: { ...DEFAULTS, prompt: "Job " + n, seed: String(n), width: 256, height: 256, images: [img] },
          results: [{ blob, mime: "image/png", width: 256, height: 256, seed: String(n) }],
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
    localStorage.setItem("qwen-storage-enabled", "true");
  });
  await page.addInitScript(() => {
    const calls: [string, string][] = [];
    Object.assign(window, { storageReads: calls });
    const original = IDBObjectStore.prototype.get;
    const all = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.get = function (key) {
      calls.push([this.name, "get"]);
      return original.call(this, key);
    };
    IDBObjectStore.prototype.getAll = function (...args) {
      calls.push([this.name, "getAll"]);
      return all.apply(this, args);
    };
  });
  await page.reload();
  await expect(page.locator("#image-history-count")).toHaveText("32 images");
  await expect(page.locator(".image-history-card")).toHaveCount(12);
  await page.locator("#history-open").click();
  await expect(page.locator(".history-item")).toHaveCount(30);
  await page.getByRole("button", { name: "Older jobs" }).click();
  await expect(page.locator(".history-item")).toHaveCount(2);
  const reads = () => page.evaluate(() => (window as any).storageReads as [string, string][]);
  expect((await reads()).filter(([store]) => store === "jobs" || store === "references")).toEqual([]);
  expect((await reads()).filter(([store]) => store === "job-frames").length).toBeLessThanOrEqual(12);
  const rows = page.locator(".history-item");
  await rows.last().getByRole("button", { name: "View results" }).click();
  await expect(page.locator(".result-seed")).toHaveText("Seed 0");
  expect((await reads()).filter(([store]) => store === "jobs")).toEqual([["jobs", "get"]]);
  await page.locator("#history-open").click();
  await page.getByRole("button", { name: "Older jobs" }).click();
  await rows.last().getByRole("button", { name: "Reuse request" }).click();
  await expect(page.locator("#prompt")).toHaveValue("Job 0");
  await expect(page.locator(".reference-card")).toHaveCount(1);
  expect(await page.evaluate(async () => {
    return await new Promise<number>((resolve, reject) => {
      const op = indexedDB.open("qwen-image-studio");
      op.onsuccess = () => {
        const req = op.result.transaction("references").objectStore("references").count();
        req.onsuccess = () => { resolve(req.result); op.result.close(); };
        req.onerror = () => reject(req.error);
      };
      op.onerror = () => reject(op.error);
    });
  })).toBe(1);
});
