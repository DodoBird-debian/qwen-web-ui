import { test, expect } from "@playwright/test";

test("ten-image shortcut previews 4+4+2 and sends only three sequential API requests", async ({ page }) => {
  const bodies: any[] = [];
  let image = "";
  await page.route("**/api/runpod/**", route => {
    if (route.request().url().endsWith("/run")) {
      bodies.push(JSON.parse(route.request().postData()!));
      return route.fulfill({ json: { id: `batch-${bodies.length}`, status: "IN_QUEUE" } });
    }
    const input = bodies[bodies.length - 1].input;
    return route.fulfill({ json: { id: `batch-${bodies.length}`, status: "COMPLETED", output: {
      images: Array.from({ length: input.num_images }, (_, i) => ({ image_base64: image,
        mime_type: "image/png", width: 512, height: 512, seed: input.seed + i })),
    } } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Create 10 images", exact: true }).click();
  await expect(page.locator("#series-total")).toHaveValue("10");
  await expect(page.locator("#series-batch")).toHaveValue("4");
  await expect(page.locator("#run-summary")).toContainText("4 + 4 + 2");
  await expect(page.locator("#image-count option")).toHaveCount(4);
  await page.locator("#connection-open").click();
  await page.locator("#endpoint-id").fill("batch-endpoint");
  await page.locator("#api-key").fill("fixture-key");
  await page.locator("#connection-form button[type=submit]").click();
  image = await page.evaluate(() => {
    const c = document.createElement("canvas");c.width = c.height = 512;
    c.getContext("2d")!.fillRect(0, 0, 512, 512);
    return c.toDataURL().split(",")[1];
  });
  await page.locator("#prompt").fill("Ten ceramic vases");
  await page.locator("#width").fill("512");await page.locator("#height").fill("512");
  await page.locator("#seed").fill("100");
  await expect(page.locator("#generate")).toBeEnabled();
  await page.getByRole("button", { name: "Preview request 3: 2 images" }).click();
  await expect(page.locator("#batch-details")).toContainText("108, 109");
  expect(bodies).toHaveLength(0);
  await page.locator("#generate").click();
  await expect(page.locator("#run-progress")).toContainText("completed · 10 / 10");
  expect(bodies.map(body => body.input.num_images)).toEqual([4, 4, 2]);
  expect(bodies.map(body => body.input.seed)).toEqual([100, 104, 108]);
  await expect(page.locator("#run-batches .completed")).toHaveCount(3);
  await page.locator("#run-batches button").first().click();
  expect(bodies).toHaveLength(3);
  await expect(page.locator(".raw-variant img")).toHaveCount(10);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#run-controls").scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#run-controls").screenshot({ path: "/tmp/qwen-batch-planner.png" });
});
