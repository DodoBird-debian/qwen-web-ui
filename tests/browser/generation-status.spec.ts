import { test, expect, type Page } from "@playwright/test";

async function start(page: Page) {
  await page.goto("/");
  await page.locator("#connection-open").click();
  await page.locator("#endpoint-id").fill("activity-endpoint");
  await page.locator("#api-key").fill("fixture-key");
  await page.locator("#connection-form button[type=submit]").click();
  await page.locator("#prompt").fill("A ceramic vase");
  await page.locator("#width").fill("512");
  await page.locator("#height").fill("512");
  await page.locator("#seed").fill("100");
  await expect(page.locator("#generate")).toBeEnabled();
}

test("shows submission, queue, running and elapsed time; a cancel acknowledgement alone never unlocks generation", async ({ page }) => {
  let accept!: () => void;
  const submitted = new Promise<void>(resolve => { accept = resolve; });
  let status = "IN_QUEUE", posts = 0, cancels = 0;
  await page.route("**/api/runpod/**", async route => {
    const url = route.request().url();
    if (url.endsWith("/run")) {
      posts++;
      await submitted;
      return route.fulfill({ json: { id: "activity-job", status: "IN_QUEUE" } });
    }
    if (url.includes("/cancel/")) {
      cancels++;
      return route.fulfill({ json: { id: "activity-job", status: "CANCELLED" } });
    }
    return route.fulfill({ json: { id: "activity-job", status } });
  });
  await start(page);
  await page.locator("#generate").click();
  await expect(page.locator("#generation-state")).toHaveText("Submitting generation…");
  accept();
  await expect(page.locator("#generation-state")).toContainText("Queued");
  status = "IN_PROGRESS";
  await expect(page.locator("#generation-state")).toContainText("Generating image");
  await expect(page.locator(".generation-elapsed")).not.toHaveText("0s elapsed");
  await expect(page.locator("#stop-generation")).toBeVisible();
  await page.screenshot({ path: "/tmp/qwen-generation-desktop.png", fullPage: true });
  await page.locator("#stop-generation").click();
  await expect(page.locator("#generation-state")).toContainText("waiting for RunPod confirmation");
  await expect(page.locator("#stop-generation")).toBeDisabled();
  await expect(page.locator("#generate")).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("qwen-pending-submission")!).id)).toBe("activity-job");
  status = "CANCELLED";
  await expect(page.locator("#generation-state")).toHaveText("RunPod confirmed cancellation");
  await expect(page.locator("#generate")).toBeEnabled();
  expect(posts).toBe(1);
  expect(cancels).toBe(1);
});

test("failed cancellation remains visibly unconfirmed on mobile and can be retried", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let cancels = 0;
  await page.route("**/api/runpod/**", async route => {
    const url = route.request().url();
    if (url.includes("/cancel/")) {
      cancels++;
      if (cancels === 1) return route.fulfill({ status: 503, body: "unavailable" });
    }
    return route.fulfill({ json: { id: "activity-job", status: cancels > 1 ? "CANCELLED" : url.endsWith("/run") ? "IN_QUEUE" : "IN_PROGRESS" } });
  });
  await start(page);
  await page.locator("#generate").click();
  await expect(page.locator("#generation-state")).toContainText("Generating image");
  await page.locator("#stop-generation").click();
  await expect(page.locator("#generation-activity")).toContainText("Cancellation is unconfirmed");
  await expect(page.locator("#stop-generation")).toHaveText("Retry cancellation");
  await expect(page.locator("#generate")).toBeDisabled();
  await page.locator("#generation-activity").scrollIntoViewIfNeeded();
  const box = await page.locator("#generation-activity").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "/tmp/qwen-generation-mobile.png", fullPage: true });
  await page.locator("#stop-generation").click();
  await expect(page.locator("#generation-state")).toHaveText("RunPod confirmed cancellation");
  await expect(page.locator("#generate")).toBeEnabled();
  expect(cancels).toBe(2);
});

test("keeps the actual result when completion wins a cancellation race", async ({ page }) => {
  let cancelled = false, png = "";
  await page.route("**/api/runpod/**", async route => {
    const url = route.request().url();
    if (url.includes("/cancel/")) {
      cancelled = true;
      return route.fulfill({ json: { id: "activity-job", status: "CANCELLED" } });
    }
    return route.fulfill({ json: {
      id: "activity-job",
      status: url.endsWith("/run") ? "IN_QUEUE" : cancelled ? "COMPLETED" : "IN_PROGRESS",
      ...(cancelled ? { output: { images: [{ image_base64: png, mime_type: "image/png", width: 512, height: 512, seed: 100 }] } } : {}),
    } });
  });
  await start(page);
  png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    return c.toDataURL().split(",")[1];
  });
  await page.locator("#generate").click();
  await expect(page.locator("#generation-state")).toContainText("Generating image");
  await page.locator("#stop-generation").click();
  await expect(page.locator("#generation-state")).toHaveText("Generation completed");
  await expect(page.locator("#generation-activity")).toContainText("completed before cancellation");
  await expect(page.locator(".result-seed")).toHaveText("Seed 100");
  await expect(page.locator("#generate")).toBeEnabled();
});

test("worker whitespace-only prompts never submit a job", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/runpod/**", route => {
    if (route.request().url().endsWith("/run")) posts++;
    return route.fulfill({ json: {} });
  });
  await start(page);
  for (const whitespace of ["\u0085", "\u001c", " \u0085\u001f "]) {
    await page.locator("#prompt").fill(whitespace);
    await expect(page.locator("#validation")).toContainText("prompt");
    await expect(page.locator("#generate")).toBeDisabled();
  }
  expect(posts).toBe(0);
});

test("retrying a series cancellation stops the current server job and leaves remaining requests unsent", async ({ page }) => {
  let posts = 0, cancels = 0;
  await page.route("**/api/runpod/**", async route => {
    const url = route.request().url();
    if (url.endsWith("/run")) posts++;
    if (url.includes("/cancel/")) {
      cancels++;
      if (cancels === 1) return route.fulfill({ status: 503, body: "unavailable" });
    }
    return route.fulfill({ json: { id: "activity-job", status: cancels > 1 ? "CANCELLED" : url.endsWith("/run") ? "IN_QUEUE" : "IN_PROGRESS" } });
  });
  await start(page);
  await page.locator("#run-kind").selectOption("series");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.locator("#generate").click();
  await expect(page.locator("#generation-state")).toContainText("Generating image");
  await page.locator("#stop-generation").click();
  await expect(page.locator("#stop-generation")).toHaveText("Retry cancellation");
  await page.locator("#stop-generation").click();
  await expect(page.locator("#generation-state")).toHaveText("RunPod confirmed cancellation");
  await expect(page.locator("#run-progress")).toContainText("stopped · 0 / 20");
  await expect(page.locator("#generate")).toBeEnabled();
  expect(posts).toBe(1);
  expect(cancels).toBe(2);
});
