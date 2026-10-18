import { test, expect, type Page } from "@playwright/test";

async function png(
  page: Page,
  color = "#697f4c",
  width = 512,
  height = 512,
): Promise<string> {
  return page.evaluate(
    ({ color, width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { color, width, height },
  );
}
async function connect(page: Page) {
  await page.getByRole("button", { name: "Connect RunPod" }).click();
  await page.locator("#endpoint-id").fill("mock-endpoint");
  await page.locator("#api-key").fill("fake-test-key");
  await page.locator("#connection-form button[type=submit]").click();
}
test("server defaults connect automatically without sending or storing a browser API key", async ({ page }) => {
  await page.route("**/config.json", (route) => route.fulfill({
    json: { endpointId: "server-endpoint", serverAuth: true, gpuGiB: 80 },
  }));
  const keys: (string | undefined)[] = [];
  let output = "";
  await page.route("**/api/runpod/**", async (route) => {
    keys.push(route.request().headers()["x-runpod-api-key"]);
    if (route.request().url().endsWith("/run"))
      return route.fulfill({ json: { id: "server-job", status: "IN_QUEUE" } });
    return route.fulfill({ json: { id: "server-job", status: "COMPLETED", output: { images: [
      { image_base64: output, mime_type: "image/png", width: 512, height: 512, seed: 42 },
    ] } } });
  });
  await page.goto("/");
  await expect(page.locator("#connection-label")).toHaveText("server-endpoint");
  await page.locator("#connection-open").click();
  await expect(page.locator("#api-key")).not.toHaveAttribute("required");
  await page.locator("#endpoint-id").fill("other-endpoint");
  await expect(page.locator("#api-key")).toHaveAttribute("required", "");
  await page.locator("#endpoint-id").fill("server-endpoint");
  await page.locator("#connection-form button[type=submit]").click();
  output = await png(page);
  await page.locator("#prompt").fill("A fixture using server defaults");
  await page.locator("#width").fill("512");
  await page.locator("#height").fill("512");
  await page.locator("#seed").fill("42");
  await page.locator("#generate").click();
  await expect(page.locator(".result-seed")).toHaveText("Seed 42");
  expect(keys.length).toBeGreaterThanOrEqual(2);
  expect(keys.every((key) => key === undefined)).toBe(true);
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual({});
});
test("desktop/mobile controls, connection, exact seed transport, completed result and persistence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "What will you create?" }),
  ).toBeVisible();
  const output = await png(page),
    bodies: string[] = [];
  await page.route("**/api/runpod/**", async (route) => {
    if (route.request().url().endsWith("/run")) {
      bodies.push(route.request().postData()!);
      await route.fulfill({ json: { id: "job-1", status: "IN_QUEUE" } });
    } else
      await route.fulfill({
        contentType: "application/json",
        body: `{"id":"job-1","status":"COMPLETED","output":{"model":"Qwen/Qwen-Image-2.1","images":[{"image_base64":"${output}","mime_type":"image/png","width":512,"height":512,"seed":9223372036854775807}],"inference_seconds":1.2}}`,
      });
  });
  await connect(page);
  await page.locator("#prompt").fill("A small ceramic fox");
  await page.locator("#width").fill("512");
  await page.locator("#height").fill("512");
  await page.locator("#seed").fill("9223372036854775807");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator(".result-seed")).toHaveText(
    "Seed 9223372036854775807",
  );
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toContain('"seed":9223372036854775807');
  expect(new TextEncoder().encode(bodies[0]).length).toBeLessThanOrEqual(
    10_000_000,
  );
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...localStorage }),
  );
  expect(storage).not.toContain("fake-test-key");
  await page.locator("#persist-browser").check();
  await expect(page.locator("#storage-mode-note")).toContainText("Saved in this browser");
  await page.locator("#save-project").click();
  await expect(page.locator("#toast")).toContainText("Project saved");
  await page.reload();
  await page.locator("#project-open").click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator("#prompt")).toHaveValue("A small ceramic fox");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({ path: "test-results/studio.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("references insert at caret and follow their image when reordered", async ({
  page,
}) => {
  await page.goto("/");
  const one = await png(page),
    two = await png(page, "#d5a97b");
  await page.locator("#reference-upload").setInputFiles([
    {
      name: "green.png",
      mimeType: "image/png",
      buffer: Buffer.from(one, "base64"),
    },
    {
      name: "ochre.png",
      mimeType: "image/png",
      buffer: Buffer.from(two, "base64"),
    },
  ]);
  await expect(page.locator(".reference-card")).toHaveCount(2);
  await page.locator("#prompt").fill("Use ");
  await page
    .locator(".reference-card")
    .first()
    .getByRole("button", { name: "Insert ↗", exact: true })
    .click();
  await expect(page.locator("#prompt")).toHaveValue("Use <image1>");
  await page
    .locator(".reference-card")
    .first()
    .getByTitle("Move reference down")
    .click();
  await expect(page.locator("#prompt")).toHaveValue("Use <image2>");
  await page.locator("#request-preview").click();
  await expect(page.locator(".json-preview")).toContainText(
    "base64 characters",
  );
});
test("inpaint sends only frozen fields and creates a local composite preserving source outside mask", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const original = await png(page, "#204060"),
    generated = await png(page, "#cc5500");
  const submissions: any[] = [];
  await page.route("**/api/runpod/**", async (route) => {
    if (route.request().url().endsWith("/run")) {
      submissions.push(JSON.parse(route.request().postData()!));
      await route.fulfill({ json: { id: "inpaint-1", status: "IN_QUEUE" } });
    } else
      await route.fulfill({
        json: {
          id: "inpaint-1",
          status: "COMPLETED",
          output: {
            images: [
              {
                image_base64: generated,
                mime_type: "image/png",
                width: 512,
                height: 512,
                seed: 42,
              },
            ],
          },
        },
      });
  });
  await connect(page);
  await page.locator("[data-mode=inpaint]").click();
  await page.locator("#source-upload").setInputFiles({
    name: "source.png",
    mimeType: "image/png",
    buffer: Buffer.from(original, "base64"),
  });
  await page.locator("#width").fill("512");
  await page.locator("#height").fill("512");
  await page.locator("#crop-mask").uncheck();
  await page.locator("#prompt").fill("Make a small orange patch");
  const mask = page.locator(".mask-layer");
  await expect(mask).toBeVisible();
  await mask.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => (await mask.boundingBox())?.width || 0)
    .toBeGreaterThan(100);
  const box = await mask.boundingBox();
  if (!box) throw new Error("No canvas");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator(".result-heading strong")).toHaveText(
    "Local composite",
  );
  await expect(page.locator(".guide-card")).toHaveCount(2);
  expect(submissions).toHaveLength(1);
  expect(submissions[0].input.images).toHaveLength(2);
  expect(submissions[0].input.mask).toBeUndefined();
  expect(submissions[0].input.strength).toBeUndefined();
  expect(submissions[0].input.prompt).toContain("<image2>");
  const pixels = await page
    .locator(".composite-variant .result-preview img")
    .evaluate(async (element: HTMLImageElement) => {
      await element.decode();
      const canvas = document.createElement("canvas");
      canvas.width = element.naturalWidth;
      canvas.height = element.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(element, 0, 0);
      return {
        corner: Array.from(ctx.getImageData(0, 0, 1, 1).data),
        center: Array.from(ctx.getImageData(256, 256, 1, 1).data),
      };
    });
  expect(pixels.corner).toEqual([32, 64, 96, 255]);
  expect(pixels.center).toEqual([204, 85, 0, 255]);
  await page.locator("#view-editor").click();
  await expect(mask).toBeVisible();
  expect(errors).toEqual([]);
});
test("crop inpaint maps the edited region back into the source without changing outside pixels", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const original = await png(page, "#204060"),
    generated = await png(page, "#cc5500");
  const submissions: any[] = [];
  await page.route("**/api/runpod/**", async (route) => {
    if (route.request().url().endsWith("/run")) {
      submissions.push(JSON.parse(route.request().postData()!));
      await route.fulfill({ json: { id: "inpaint-1", status: "IN_QUEUE" } });
    } else
      await route.fulfill({
        json: {
          id: "inpaint-1",
          status: "COMPLETED",
          output: {
            images: [
              {
                image_base64: generated,
                mime_type: "image/png",
                width: 512,
                height: 512,
                seed: 42,
              },
            ],
          },
        },
      });
  });
  await connect(page);
  await page.locator("[data-mode=inpaint]").click();
  await page.locator("#source-upload").setInputFiles({
    name: "source.png",
    mimeType: "image/png",
    buffer: Buffer.from(original, "base64"),
  });
  await page.locator("#width").fill("512");
  await page.locator("#height").fill("512");
  await page.locator("#crop-mask").check();
  await page.locator("#prompt").fill("Make a small orange patch");
  const mask = page.locator(".mask-layer");
  await expect(mask).toBeVisible();
  await mask.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => (await mask.boundingBox())?.width || 0)
    .toBeGreaterThan(100);
  const box = await mask.boundingBox();
  if (!box) throw new Error("No canvas");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator(".result-heading strong")).toHaveText(
    "Local composite",
  );
  expect(submissions).toHaveLength(1);
  expect(submissions[0].input.images).toHaveLength(2);
  expect(submissions[0].input.mask).toBeUndefined();
  expect(submissions[0].input.strength).toBeUndefined();
  expect(submissions[0].input.prompt).toContain("<image2>");
  const pixels = await page
    .locator(".composite-variant .result-preview img")
    .evaluate(async (element: HTMLImageElement) => {
      await element.decode();
      const canvas = document.createElement("canvas");
      canvas.width = element.naturalWidth;
      canvas.height = element.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(element, 0, 0);
      return {
        corner: Array.from(ctx.getImageData(0, 0, 1, 1).data),
        center: Array.from(ctx.getImageData(256, 256, 1, 1).data),
      };
    });
  expect(pixels.corner).toEqual([32, 64, 96, 255]);
  expect(pixels.center).toEqual([204, 85, 0, 255]);
  await page.locator("#view-editor").click();
  await expect(mask).toBeVisible();
  expect(errors).toEqual([]);
});
test("completed worker errors are shown and a lost submission is not retried", async ({
  page,
}) => {
  await page.goto("/");
  await connect(page);
  await page.locator("#prompt").fill("Test validation");
  let posts = 0;
  await page.route("**/api/runpod/**", async (route) => {
    if (route.request().url().endsWith("/run")) {
      posts++;
      await route.fulfill({ json: { id: "error-1", status: "IN_QUEUE" } });
    } else
      await route.fulfill({
        json: {
          id: "error-1",
          status: "COMPLETED",
          output: {
            error: "Prompt and reference layout exceed positional limits.",
          },
        },
      });
  });
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator("#job-status")).toContainText("positional limits");
  expect(posts).toBe(1);
  await page.unroute("**/api/runpod/**");
  await page.route("**/api/runpod/**", async (route) => {
    posts++;
    await route.abort();
  });
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator("#toast")).toContainText("fetch");
  await page.waitForTimeout(2000);
  expect(posts).toBe(2);
});

test("separate output jobs submit explicit consecutive seeds with integer wrap", async ({
  page,
}) => {
  await page.goto("/");
  const image = await png(page),
    submissions: string[] = [];
  await page.route("**/api/runpod/**", async (route) => {
    if (route.request().url().endsWith("/run")) {
      submissions.push(route.request().postData()!);
      await route.fulfill({
        json: { id: `split-${submissions.length}`, status: "IN_QUEUE" },
      });
    } else {
      const seed =
        submissions[submissions.length - 1].match(/"seed":(-?\d+)/)![1];
      await route.fulfill({
        contentType: "application/json",
        body: `{"id":"split-${submissions.length}","status":"COMPLETED","output":{"images":[{"image_base64":"${image}","mime_type":"image/png","width":512,"height":512,"seed":${seed}}]}}`,
      });
    }
  });
  await connect(page);
  await page.locator("#prompt").fill("A green tile");
  await page.locator("#width").fill("512");
  await page.locator("#height").fill("512");
  await page.locator("#seed").fill("9223372036854775807");
  await page.locator("#image-count").selectOption("3");
  await page.locator("#separate-jobs").check();
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator("#job-status")).toContainText(
    "Completed · split-3",
  );
  expect(submissions.map((body) => body.match(/"seed":(-?\d+)/)![1])).toEqual([
    "9223372036854775807",
    "0",
    "1",
  ]);
  expect(
    submissions.every((body) => JSON.parse(body).input.num_images === 1),
  ).toBe(true);
  await page.locator("#history-open").click();
  await expect(page.locator(".history-item")).toHaveCount(3);
});

test("polling pause does not cancel, explicit cancellation and resume use the original job", async ({
  page,
}) => {
  await page.goto("/");
  let submits = 0,
    cancels = 0;
  await page.route("**/api/runpod/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/run")) {
      submits++;
      await route.fulfill({ json: { id: "resume-1", status: "IN_QUEUE" } });
    } else if (url.includes("/cancel/")) {
      cancels++;
      await route.fulfill({ json: { id: "resume-1", status: "CANCELLED" } });
    } else
      await route.fulfill({
        json: { id: "resume-1", status: cancels ? "CANCELLED" : "IN_PROGRESS" },
      });
  });
  await connect(page);
  await page.locator("#prompt").fill("Resume test");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator("#job-status")).toContainText(
    "Generating on RunPod",
  );
  await page.locator("#pause-job").click();
  await expect(page.locator("#resume-job")).toBeVisible();
  expect(cancels).toBe(0);
  expect(submits).toBe(1);
  await page.locator("#cancel-job").click();
  await expect(page.locator("#toast")).toContainText("Cancellation requested");
  await expect(page.locator("#job-status")).toContainText("CANCELLED");
  expect(submits).toBe(1);
  expect(cancels).toBe(1);
});
