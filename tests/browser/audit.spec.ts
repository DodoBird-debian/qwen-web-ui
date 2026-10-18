import { test, expect, type Page } from "@playwright/test";
async function connect(page: Page) {
  await page.locator("#connection-open").click();
  await page.locator("#endpoint-id").fill("audit-endpoint");
  await page.locator("#api-key").fill("test-key");
  await page.locator("#connection-form button[type=submit]").click();
}
async function png(page: Page) {
  return page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    c.getContext("2d")!.fillRect(0, 0, 512, 512);
    return c.toDataURL().split(",")[1];
  });
}
test("pausing and reloading keep an accepted job guarded until cancellation is confirmed", async ({
  page,
}) => {
  let posts = 0,
    cancelled = false;
  await page.route("**/api/runpod/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/run")) posts++;
    if (url.includes("/cancel/")) cancelled = true;
    await route.fulfill({
      json: {
        id: "existing",
        status: cancelled
          ? "CANCELLED"
          : url.endsWith("/run")
            ? "IN_QUEUE"
            : "IN_PROGRESS",
      },
    });
  });
  await page.goto("/");
  await connect(page);
  await page.locator("#prompt").fill("A fox");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator("#pause-job")).toBeVisible();
  await page.locator("#pause-job").click();
  await expect(page.locator("#resume-job")).toBeVisible();
  await expect(page.locator("#generate")).toBeDisabled();
  await page.reload();
  await connect(page);
  await page.locator("#prompt").fill("Another fox");
  await expect(page.locator(".submission-notice")).toContainText("unresolved");
  await expect(page.locator("#generate")).toBeDisabled();
  await page.locator("#cancel-job").click();
  await expect(page.locator("#toast")).toContainText("Cancellation requested");
  await expect(page.locator("#job-status")).toContainText("CANCELLED");
  await expect(page.locator("#generate")).toBeEnabled();
  expect(posts).toBe(1);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("qwen-pending-submission"),
    ),
  ).toBeNull();
});

test("a lost submission response blocks a repeat across reload until explicit endpoint reconciliation", async ({
  page,
}) => {
  let posts = 0;
  await page.route("**/api/runpod/**", async (route) => {
    posts++;
    await route.abort();
  });
  await page.goto("/");
  await connect(page);
  await page.locator("#prompt").fill("A fox");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator(".submission-notice")).toContainText(
    "response was lost",
  );
  await expect(page.locator("#generate")).toBeDisabled();
  await page.reload();
  await connect(page);
  await page.locator("#prompt").fill("A fox");
  await expect(page.locator("#generate")).toBeDisabled();
  await page
    .getByRole("button", { name: "I checked RunPod; allow a new request" })
    .click();
  await expect(page.locator("#generate")).toBeEnabled();
  expect(posts).toBe(1);
});

test("series updates keep previous image nodes and URLs instead of decoding them again", async ({
  page,
}) => {
  await page.goto("/");
  const image = await png(page);
  let posts = 0,
    secondReady!: () => void;
  const second = new Promise<void>((resolve) => {
    secondReady = resolve;
  });
  await page.route("**/api/runpod/**", async (route) => {
    if (route.request().url().endsWith("/run")) {
      posts++;
      await route.fulfill({ json: { id: `j-${posts}`, status: "IN_QUEUE" } });
    } else {
      if (posts === 2) await second;
      await route.fulfill({
        json: {
          id: `j-${posts}`,
          status: "COMPLETED",
          output: {
            images: [
              {
                image_base64: image,
                width: 512,
                height: 512,
                mime_type: "image/png",
                seed: 99 + posts,
              },
            ],
          },
        },
      });
    }
  });
  await connect(page);
  await page.locator("#prompt").fill("A fox");
  await page.locator("#width").fill("512");
  await page.locator("#height").fill("512");
  await page.locator("#seed").fill("100");
  await page.locator("#image-count").selectOption("2");
  await page.locator("#separate-jobs").check();
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  const first = page.locator(".result-preview img").first();
  await expect(first).toBeVisible();
  const url = await first.getAttribute("src");
  await first.evaluate((el) => {
    el.setAttribute("data-reused", "yes");
  });
  secondReady();
  await expect(page.locator("#run-progress")).toContainText("2 / 2");
  await expect(page.locator(".result-preview img")).toHaveCount(2);
  await expect(first).toHaveAttribute("data-reused", "yes");
  await expect(first).toHaveAttribute("src", url!);
});

test.describe("phone interaction", () => {
  test.use({
    viewport: { width: 360, height: 800 },
    hasTouch: true,
    isMobile: true,
  });
  test("touch canvas, two-finger interference, navigation, generation and result inspection", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    const image = await png(page);
    await page.route("**/api/runpod/**", async (route) => {
      await route.fulfill({
        json: {
          id: "phone",
          status: route.request().url().endsWith("/run")
            ? "IN_QUEUE"
            : "COMPLETED",
          output: {
            images: [
              {
                image_base64: image,
                width: 512,
                height: 512,
                mime_type: "image/png",
                seed: 42,
              },
            ],
          },
        },
      });
    });
    await connect(page);
    await page.locator("[data-mode=inpaint]").click();
    await page
      .locator("#source-upload")
      .setInputFiles({
        name: "source.png",
        mimeType: "image/png",
        buffer: Buffer.from(image, "base64"),
      });
    await page.locator("#width").fill("512");
    await page.locator("#height").fill("512");
    await page.locator("#seed").fill("42");
    await page.locator("#crop-mask").uncheck();
    await page.locator("#prompt").fill("Change this patch");
    const mask = page.locator(".mask-layer");
    await mask.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => (await mask.boundingBox())?.width || 0)
      .toBeGreaterThan(240);
    const box = (await mask.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const a = {
        x: box.x + box.width * 0.25,
        y: box.y + box.height * 0.25,
        id: 1,
      },
      b = { x: box.x + box.width * 0.8, y: box.y + box.height * 0.8, id: 2 };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [a],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [a, b],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { ...a, x: a.x + 10 },
        { ...b, x: b.x - 10 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    const pixels = await mask.evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext("2d")!;
      return [
        ctx.getImageData(128, 128, 1, 1).data[3],
        ctx.getImageData(410, 410, 1, 1).data[3],
      ];
    });
    expect(pixels).toEqual([255, 0]);
    await page
      .getByRole("navigation", { name: "Workspace sections" })
      .getByRole("button", { name: "Settings" })
      .tap();
    await expect(page.locator("#width")).toBeInViewport();
    for (const width of [360, 390, 844]) {
      await page.setViewportSize({ width, height: 800 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await page
          .locator("#prompt")
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      ).toBeGreaterThanOrEqual(16);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("navigation", { name: "Workspace sections" })
      .getByRole("button", { name: "Workspace" })
      .tap();
    await expect(page.locator("#generate")).toBeEnabled();
    await page.locator("#generate").tap();
    await expect(page.locator(".raw-variant img")).toBeVisible();
    await expect(page.locator(".composite-variant img")).toBeVisible();
    await page.getByRole("button", { name: "Inspect raw", exact: true }).tap();
    await expect(page.locator(".inspector")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/phone-inspector.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
});

test("region metadata reuses prepared guides; returning feather to global invalidates pixel preparation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    (window as any).encodeCount = 0;
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      (window as any).encodeCount++;
      return original.apply(this, args);
    };
  });
  await page.goto("/");
  const image = await png(page);
  await page.locator("[data-mode=inpaint]").click();
  await page
    .locator("#source-upload")
    .setInputFiles({
      name: "source.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
  await page.locator("#prompt").fill("Change this patch");
  const mask = page.locator(".mask-layer");
  await mask.scrollIntoViewIfNeeded();
  const box = (await mask.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#generate")).toBeEnabled();
  const before = await page.evaluate(() => (window as any).encodeCount);
  await page.getByLabel("Region 1 instruction").fill("Make it orange");
  await page.getByLabel("Region 1 instruction").press("Tab");
  await expect(page.locator("#generate")).toBeEnabled();
  expect(await page.evaluate(() => (window as any).encodeCount)).toBe(before);
  await page.getByLabel("Region 1 feather").fill("8");
  await page.getByLabel("Region 1 feather").press("Tab");
  await expect
    .poll(async () => page.evaluate(() => (window as any).encodeCount))
    .toBeGreaterThan(before);
  await expect(page.locator("#generate")).toBeEnabled();
  const feathered = await page.evaluate(() => (window as any).encodeCount);
  await page.getByLabel("Region 1 feather").fill("");
  await page.getByLabel("Region 1 feather").press("Tab");
  await expect
    .poll(async () => page.evaluate(() => (window as any).encodeCount))
    .toBeGreaterThan(feathered);
});

test("upgrades v1 browser history and trims by metadata while retaining active jobs", async ({
  page,
}) => {
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: { historyLimit: 1 } }),
  );
  await page.goto("/");
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("qwen-image-studio", 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore("projects", { keyPath: "id" });
        open.result.createObjectStore("jobs", { keyPath: "id" });
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result,
          tx = db.transaction("jobs", "readwrite");
        for (const [id, status, created] of [
          ["old", "FAILED", 1],
          ["active", "IN_PROGRESS", 2],
        ])
          tx.objectStore("jobs").put({
            id,
            runpodId: id,
            endpoint: "audit-endpoint",
            status,
            created,
            input: { prompt: "old" },
          });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
    localStorage.setItem("qwen-storage-enabled", "true");
  });
  await page.reload();
  const image = await png(page);
  await page.route("**/api/runpod/**", (route) =>
    route.fulfill({
      json: {
        id: "latest",
        status: route.request().url().endsWith("/run")
          ? "IN_QUEUE"
          : "COMPLETED",
        output: {
          images: [
            {
              image_base64: image,
              mime_type: "image/png",
              width: 512,
              height: 512,
              seed: 42,
            },
          ],
        },
      },
    }),
  );
  await connect(page);
  await page.locator("#prompt").fill("A fox");
  await page.locator("#width").fill("512");
  await page.locator("#height").fill("512");
  await page.locator("#seed").fill("42");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator(".result-card")).toHaveCount(1);
  await page.locator("#history-open").click();
  await expect(page.locator(".history-item")).toHaveCount(2);
  const data = await page.evaluate(
    async () =>
      new Promise<any>((resolve) => {
        const open = indexedDB.open("qwen-image-studio");
        open.onsuccess = () => {
          const db = open.result,
            request = db.transaction("jobs").objectStore("jobs").getAllKeys();
          request.onsuccess = () => {
            resolve({ version: db.version, keys: request.result });
            db.close();
          };
        };
      }),
  );
  expect(data.version).toBe(2);
  expect(data.keys.sort()).toEqual(["active", "audit-endpoint:latest"]);
});
