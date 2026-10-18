import { test, expect, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
async function image(page: Page, colour = "#204060", alpha = false) {
  return page.evaluate(
    ({ colour, alpha }) => {
      const c = document.createElement("canvas");
      c.width = c.height = 512;
      const x = c.getContext("2d")!;
      x.fillStyle = colour;
      x.fillRect(
        alpha ? 50 : 0,
        alpha ? 50 : 0,
        alpha ? 400 : 512,
        alpha ? 400 : 512,
      );
      return c.toDataURL().split(",")[1];
    },
    { colour, alpha },
  );
}
async function connect(page: Page) {
  await page.locator("#connection-open").click();
  await page.locator("#endpoint-id").fill("test-endpoint");
  await page.locator("#api-key").fill("fake-key");
  await page.locator("#connection-form button[type=submit]").click();
}
async function basic(page: Page) {
  await page.locator("#prompt").fill("A ceramic fox");
  await page.locator("#width").fill("512");
  await page.locator("#height").fill("512");
  await page.locator("#seed").fill("100");
}
function output(body: string, png: string, id: string) {
  const input = JSON.parse(body).input,
    seed = BigInt(body.match(/"seed":(\d+)/)![1]);
  const images = Array.from(
    { length: input.num_images },
    (_, i) =>
      `{"image_base64":"${png}","mime_type":"image/png","width":512,"height":512,"seed":${(seed + BigInt(i)) % 9223372036854775808n}}`,
  ).join(",");
  return `{"id":"${id}","status":"COMPLETED","output":{"images":[${images}]}}`;
}
async function mocked(page: Page, png: string) {
  const requests: string[] = [];
  await page.route("**/api/runpod/**", async (route) => {
    if (route.request().url().endsWith("/run")) {
      requests.push(route.request().postData()!);
      await route.fulfill({
        json: { id: `job-${requests.length}`, status: "IN_QUEUE" },
      });
    } else
      await route.fulfill({
        contentType: "application/json",
        body: output(
          requests[requests.length - 1],
          png,
          `job-${requests.length}`,
        ),
      });
  });
  return requests;
}
async function paint(page: Page, fx: number, fy: number) {
  const mask = page.locator(".mask-layer");
  await mask.scrollIntoViewIfNeeded();
  const box = await mask.boundingBox();
  if (!box) throw new Error("Missing mask");
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}
async function pixel(page: Page, selector: string, x: number, y: number) {
  return page.locator(selector).evaluate(
    async (img: HTMLImageElement, { x, y }) => {
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      return {
        width: c.width,
        height: c.height,
        pixel: [...ctx.getImageData(x, y, 1, 1).data],
      };
    },
    { x, y },
  );
}

test("session-only default writes no jobs or credentials to browser storage", async ({
  page,
}) => {
  await page.goto("/");
  const png = await image(page);
  await mocked(page, png);
  await connect(page);
  await basic(page);
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator(".result-card")).toHaveCount(1);
  const stored = await page.evaluate(async () => ({
    local: { ...localStorage },
    databases: await indexedDB.databases(),
  }));
  expect(stored.local).toEqual({});
  expect(stored.databases).toHaveLength(0);
  await page.reload();
  await expect(page.locator("#prompt")).toHaveValue("");
  await expect(page.locator(".result-card")).toHaveCount(0);
  await expect(page.locator("#persist-browser")).not.toBeChecked();
});

test("reference aliases, thumbnail autocomplete, role instructions, and guide offsets", async ({
  page,
}) => {
  await page.goto("/");
  const png = await image(page);
  await page
    .locator("#reference-upload")
    .setInputFiles({
      name: "portrait.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
  await page.getByLabel("Reference 1 alias").fill("Main person");
  await page.getByLabel("Reference 1 alias").press("Tab");
  await page.getByLabel("Reference 1 role").selectOption("person");
  await page.locator("#prompt").fill("Use @Main");
  await expect(page.locator(".mention-option")).toContainText("Main person");
  await page.locator("#prompt").press("Enter");
  await expect(page.locator("#prompt")).toHaveValue("Use <image1>");
  await expect(page.locator("[data-reference-uses]")).toContainText(
    "1 prompt uses",
  );
  await page
    .getByRole("button", { name: "Insert instruction", exact: true })
    .click();
  expect(await page.locator("#prompt").inputValue()).toContain(
    "Preserve the identity",
  );
  await page.locator("[data-mode=inpaint]").click();
  await expect(page.locator("#prompt")).toHaveValue(/<image3>/);
  await page.getByLabel("Reference 1 alias").fill("Renamed person");
  await page.getByLabel("Reference 1 alias").press("Tab");
  expect(await page.locator("#prompt").inputValue()).toContain("<image3>");
  await page
    .locator("#references")
    .getByRole("button", { name: "×", exact: true })
    .click();
  await expect(page.locator("#prompt")).toHaveValue(/<missing:/);
});

test("coloured regions share inpaint and show raw plus composite with outside pixels protected", async ({
  page,
}) => {
  await page.goto("/");
  const source = await image(page),
    generated = await image(page, "#cc5500");
  const requests = await mocked(page, generated);
  await connect(page);
  await basic(page);
  await page.locator("[data-mode=inpaint]").click();
  await page
    .locator("#source-upload")
    .setInputFiles({
      name: "source.png",
      mimeType: "image/png",
      buffer: Buffer.from(source, "base64"),
    });
  await page.locator("#crop-mask").uncheck();
  await page.getByLabel("Region 1 instruction").fill("Make this orange");
  await page.getByLabel("Region 1 instruction").press("Tab");
  await paint(page, 0.35, 0.5);
  await page.getByRole("button", { name: "+ Region", exact: true }).click();
  await page
    .getByLabel("Region 2 instruction")
    .fill("Change this to a ceramic detail");
  await page.getByLabel("Region 2 instruction").press("Tab");
  await paint(page, 0.65, 0.5);
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator(".raw-variant")).toBeVisible();
  await expect(page.locator(".composite-variant")).toBeVisible();
  const input = JSON.parse(requests[0]).input;
  expect(input.images).toHaveLength(2);
  expect(input.prompt).toContain("(red,");
  expect(input.prompt).toContain("(blue,");
  expect(input.prompt).toContain("ceramic detail");
  expect(input.mask).toBeUndefined();
  expect(input.regions).toBeUndefined();
  expect((await pixel(page, ".composite-variant img", 0, 0)).pixel).toEqual([
    32, 64, 96, 255,
  ]);
  expect((await pixel(page, ".raw-variant img", 0, 0)).pixel).toEqual([
    204, 85, 0, 255,
  ]);
  await page.screenshot({
    path: "test-results/regions-results.png",
    fullPage: true,
  });
  await page.locator("#view-editor").click();
  await page.locator("#mask-undo").click();
  await expect(page.locator(".region-row")).toHaveCount(2);
});

test("outpaint preserves source pixels, maps an extension, and inspects both outputs", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const source = await image(page),
    generated = await image(page, "#cc5500");
  const requests = await mocked(page, generated);
  await connect(page);
  await basic(page);
  await page.locator("#open-outpaint").click();
  await page
    .locator("#source-upload")
    .setInputFiles({
      name: "source.png",
      mimeType: "image/png",
      buffer: Buffer.from(source, "base64"),
    });
  await expect(page.locator("#outpaint-size")).toContainText("768 × 512");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator(".composite-variant")).toBeVisible();
  expect(await pixel(page, ".composite-variant img", 10, 10)).toEqual({
    width: 768,
    height: 512,
    pixel: [32, 64, 96, 255],
  });
  expect((await pixel(page, ".composite-variant img", 700, 256)).pixel).toEqual(
    [204, 85, 0, 255],
  );
  expect((await pixel(page, ".raw-variant img", 0, 0)).width).toBe(512);
  const input = JSON.parse(requests[0]).input;
  expect(input.images).toHaveLength(2);
  expect(input.outpaint).toBeUndefined();
  expect(input.prompt).toContain("Extend the scene");
  await page.screenshot({
    path: "test-results/outpaint-results.png",
    fullPage: true,
  });
  await page
    .locator(".raw-variant")
    .getByRole("button", { name: "Inspect raw", exact: true })
    .click();
  await expect(page.locator(".inspector")).toBeVisible();
  await expect(page.locator(".inspector .notice")).toContainText("512 × 512");
  await page.locator(".inspection-tools select").nth(1).selectOption("slider");
  await expect(page.locator(".inspector .notice")).toContainText(
    "mapped to source",
  );
  await expect
    .poll(() =>
      page
        .locator(".inspection-stage canvas")
        .evaluate((c: HTMLCanvasElement) => c.width),
    )
    .toBe(768);
  await page
    .locator(".inspection-tools select")
    .nth(1)
    .selectOption("alpha-difference");
  await page
    .locator(".inspector")
    .getByRole("button", { name: "100%", exact: true })
    .click();
  await page
    .locator(".inspector")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  expect(errors).toEqual([]);
});

test("20-image series supports both 4 and 1 outputs per request and retains the full collection", async ({
  page,
}) => {
  await page.goto("/");
  const png = await image(page);
  const requests = await mocked(page, png);
  await connect(page);
  await basic(page);
  await page.locator("#run-kind").selectOption("series");
  await expect(page.locator("#run-summary")).toContainText("20 images · 5");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator("#run-progress")).toContainText(
    "completed · 20 / 20",
  );
  await expect(page.locator(".result-card")).toHaveCount(20);
  expect(requests.map((b) => JSON.parse(b).input.seed)).toEqual([
    100, 104, 108, 112, 116,
  ]);
  await expect(page.locator(".result-seed").last()).toHaveText("Seed 119");
  await page.locator("#series-batch").selectOption("1");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect.poll(() => requests.length).toBe(25);
  await expect(page.locator("#run-progress")).toContainText(
    "completed · 20 / 20",
  );
  await expect(page.locator(".result-card")).toHaveCount(20);
  expect(requests.slice(5).map((b) => JSON.parse(b).input.seed)).toEqual(
    Array.from({ length: 20 }, (_, i) => 100 + i),
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download selected ZIP" }).click();
  const file = await downloadPromise;
  const bytes = await readFile((await file.path())!);
  const members = unzipSync(bytes);
  expect(Object.keys(members)).toHaveLength(21);
  expect(strFromU8(members["manifest.json"])).toContain('"119"');
});

test("parameter grid labels nine fixed-seed results and submits distinct legal requests", async ({
  page,
}) => {
  await page.goto("/");
  const png = await image(page);
  const requests = await mocked(page, png);
  await connect(page);
  await basic(page);
  await page.locator("#run-kind").selectOption("grid");
  await expect(page.locator("#run-summary")).toContainText("9 images · 9");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator("#run-progress")).toContainText(
    "completed · 9 / 9",
  );
  await expect(page.locator(".result-card")).toHaveCount(9);
  const inputs = requests.map((b) => JSON.parse(b).input);
  expect(new Set(inputs.map((i) => i.seed))).toEqual(new Set([100]));
  expect(inputs.map((i) => [i.true_cfg_scale, i.num_inference_steps])).toEqual([
    [1, 20],
    [1, 40],
    [1, 60],
    [2, 20],
    [2, 40],
    [2, 60],
    [3, 20],
    [3, 40],
    [3, 60],
  ]);
  expect(inputs.every((i) => i.num_images === 1)).toBe(true);
  await expect(page.locator(".result-label").last()).toContainText("512 × 512");
  const filePromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Contact sheet", exact: true })
    .click();
  expect((await filePromise).suggestedFilename()).toBe(
    "qwen-contact-sheet.png",
  );
  await page.screenshot({
    path: "test-results/comparison-grid.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("stop after current prevents the next remote submission", async ({
  page,
}) => {
  await page.goto("/");
  const png = await image(page);
  let body = "",
    posts = 0,
    release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/runpod/**", async (route) => {
    if (route.request().url().endsWith("/run")) {
      posts++;
      body = route.request().postData()!;
      await route.fulfill({ json: { id: "held-job", status: "IN_QUEUE" } });
    } else {
      await gate;
      await route.fulfill({
        contentType: "application/json",
        body: output(body, png, "held-job"),
      });
    }
  });
  await connect(page);
  await basic(page);
  await page.locator("#run-kind").selectOption("series");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator("#job-status")).toContainText("held-job");
  await page.locator("#series-stop").click();
  release();
  await expect(page.locator("#run-progress")).toContainText("stopped · 4 / 20");
  expect(posts).toBe(1);
  await expect(page.locator(".result-card")).toHaveCount(20);
});

test("browser export measures bytes, preserves alpha, requires JPEG flattening and reports impossible targets", async ({
  page,
}) => {
  await page.goto("/");
  const png = await image(page, "#cc5500", true);
  await mocked(page, png);
  await connect(page);
  await basic(page);
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await page.getByRole("button", { name: "Export raw", exact: true }).click();
  const dialog = page.locator(".export-dialog");
  await dialog.locator("[data-trim]").check();
  await dialog
    .getByRole("button", { name: "Preview export", exact: true })
    .click();
  await expect(dialog.locator(".notice")).toContainText("400 × 400");
  await expect(
    dialog.getByRole("button", { name: "Download export", exact: true }),
  ).toBeEnabled();
  await dialog.locator("[data-trim]").uncheck();
  await dialog.locator("[data-format]").selectOption("webp");
  await dialog
    .getByRole("button", { name: "Preview export", exact: true })
    .click();
  await expect(dialog.locator(".notice")).toContainText("image/webp");
  await expect(dialog.locator(".notice")).toContainText("alpha retained");
  const alpha = await dialog
    .locator(".export-preview")
    .evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const c = document.createElement("canvas");
      c.width = c.height = 512;
      const x = c.getContext("2d")!;
      x.drawImage(img, 0, 0);
      return [
        x.getImageData(0, 0, 1, 1).data[3],
        x.getImageData(100, 100, 1, 1).data[3],
      ];
    });
  expect(alpha).toEqual([0, 255]);
  await dialog.locator("[data-format]").selectOption("jpeg");
  await dialog
    .getByRole("button", { name: "Preview export", exact: true })
    .click();
  await expect(dialog.locator(".notice")).toContainText("Enable flattening");
  await dialog.locator("[data-flatten]").check();
  await dialog
    .getByRole("button", { name: "Preview export", exact: true })
    .click();
  await expect(dialog.locator(".notice")).toContainText("alpha flattened");
  await dialog.locator("[data-target]").fill("0.000001");
  await dialog
    .getByRole("button", { name: "Preview export", exact: true })
    .click();
  await expect(dialog.locator(".notice")).toContainText("cannot fit", {timeout:15000});
  await expect(
    dialog.getByRole("button", { name: "Download export", exact: true }),
  ).toBeDisabled();
});
