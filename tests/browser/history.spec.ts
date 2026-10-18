import { test, expect, type Page } from "@playwright/test";

async function start(page: Page) {
  await page.route("**/config.json", route => route.fulfill({ json: { historyLimit: 1 } }));
  await page.goto("/");
  await page.locator("#connection-open").click();
  await page.locator("#endpoint-id").fill("history-endpoint");
  await page.locator("#api-key").fill("fixture-key");
  await page.locator("#connection-form button[type=submit]").click();
  await page.locator("#prompt").fill("A history fixture");
  await page.locator("#width").fill("512");
  await page.locator("#height").fill("512");
}
async function image(page: Page, seed: number, format = "png") {
  const data = await page.evaluate(format => {
    const c = document.createElement("canvas"); c.width = c.height = 512;
    const ctx = c.getContext("2d")!; ctx.fillStyle = "#204060"; ctx.fillRect(0, 0, 512, 512);
    return c.toDataURL(`image/${format}`).split(",")[1];
  }, format);
  return { image_base64: data, mime_type: `image/${format}`, width: 512, height: 512, seed };
}

test("image history survives menu changes, newer runs, retention limits and opt-in reload", async ({ page }) => {
  await start(page);
  const fixture = await image(page, 42);
  let posts = 0;
  await page.route("**/api/runpod/**", route => {
    if (route.request().url().endsWith("/run")) {
      posts++;
      return route.fulfill({ json: { id: `saved-${posts}`, status: "IN_QUEUE" } });
    }
    return route.fulfill({ json: { id: `saved-${posts}`, status: "COMPLETED",
      output: { images: [{ ...fixture, seed: 41 + posts }] } } });
  });
  for (const seed of [42, 43]) {
    await page.locator("#seed").fill(String(seed));
    await expect(page.locator("#generate")).toBeEnabled();
    await page.locator("#generate").click();
    await expect(page.locator(".result-seed")).toHaveText(`Seed ${seed}`);
    await expect(page.locator("#generate")).toBeEnabled();
  }
  await expect(page.locator(".image-history-card")).toHaveCount(2);
  for (const selector of ["[data-mode=inpaint]", "#open-outpaint", "[data-mode=edit]", "[data-mode=generate]"]) {
    await page.locator(selector).click();
    await expect(page.locator("#image-history")).toBeVisible();
    await page.locator('[data-history-job="saved-1"]').click();
    await expect(page.locator(".result-seed")).toHaveText("Seed 42");
  }
  await page.locator("#history-current").click();
  await expect(page.locator(".result-seed")).toHaveText("Seed 43");
  await page.locator("#persist-browser").check();
  await expect(page.locator("#image-history-note")).toContainText("Saved in this browser");
  await page.reload();
  await expect(page.locator(".image-history-card")).toHaveCount(2);
  await page.locator('[data-history-job="saved-1"]').click();
  await expect(page.locator(".result-seed")).toHaveText("Seed 42");
  expect(posts).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#image-history").scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/qwen-history-mobile.png", fullPage: true });
});

test("browsing old images while generating keeps cancellation attached to the current server job", async ({ page }) => {
  await start(page);
  const fixture = await image(page, 42);
  let posts = 0, cancelled = false;
  const cancellations: string[] = [];
  await page.route("**/api/runpod/**", route => {
    const url = route.request().url();
    if (url.endsWith("/run")) {
      posts++;
      return route.fulfill({ json: { id: `live-${posts}`, status: "IN_QUEUE" } });
    }
    if (url.includes("/cancel/")) {
      cancellations.push(url); cancelled = true;
      return route.fulfill({ json: { id: "live-2", status: "CANCELLED" } });
    }
    return route.fulfill({ json: { id: `live-${posts}`, status: posts === 1 ? "COMPLETED" : cancelled ? "CANCELLED" : "IN_PROGRESS",
      ...(posts === 1 ? { output: { images: [fixture] } } : {}) } });
  });
  await page.locator("#seed").fill("42");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator(".result-seed")).toHaveText("Seed 42");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator("#generation-state")).toContainText("Generating image");
  await page.locator('[data-history-job="live-1"]').click();
  await expect(page.locator(".result-seed")).toHaveText("Seed 42");
  await page.locator("#stop-generation").click();
  await expect(page.locator("#generation-state")).toContainText("confirmed cancellation");
  await expect(page.locator(".result-seed")).toHaveText("Seed 42");
  expect(cancellations).toHaveLength(1);
  expect(cancellations[0]).toContain("/cancel/live-2");
  expect(posts).toBe(2);
});

test("partial JPEG batches keep every received image, show omissions and never resubmit", async ({ page }) => {
  await start(page);
  const jpeg = await image(page, 42, "jpeg");
  let posts = 0;
  await page.route("**/api/runpod/**", route => {
    if (route.request().url().endsWith("/run")) {
      posts++;
      return route.fulfill({ json: { id: "partial", status: "IN_QUEUE" } });
    }
    return route.fulfill({ json: { id: "partial", status: "COMPLETED", output: {
      images: [jpeg, { ...jpeg, seed: 44 }],
      delivery: { requested_images: 4, returned_images: 2, partial: true,
        warnings: ["JPEG fallback was used. Transparency was flattened on white."] },
    } } });
  });
  await page.locator("#seed").fill("42");
  await page.locator("#image-count").selectOption("4");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator(".raw-variant img")).toHaveCount(2);
  await expect(page.locator(".collection-toolbar")).toContainText("2 / 4 images received");
  await expect(page.locator(".delivery-notice")).toContainText("Returned 2 of 4");
  await expect(page.locator(".delivery-notice")).toContainText("flattened on white");
  await expect(page.locator(".result-seed")).toHaveText(["Seed 42", "Seed 44"]);
  await expect(page.locator(".result-card").nth(1)).toContainText("Image 2 · Seed 43");
  await expect(page.locator(".result-card").nth(2)).toContainText("Image 3");
  await expect(page.locator("#job-status")).toContainText("Completed");
  await page.locator("[data-mode=inpaint]").click();
  await page.locator('[data-history-job="partial"]').click();
  await expect(page.locator(".raw-variant img")).toHaveCount(2);
  expect(posts).toBe(1);
});
