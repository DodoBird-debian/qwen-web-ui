import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  expect: { timeout: 10000 },
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173 --mode test",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
  },
  reporter: "list",
});
