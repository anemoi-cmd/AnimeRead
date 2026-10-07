import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import {
  cacheDirectory,
  verificationDirectory,
} from "./scripts/tool-paths.mjs";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 12000 },
  outputDir: resolve(cacheDirectory, "test-results"),
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: resolve(verificationDirectory, "frontend-results.json") },
    ],
  ],
  use: {
    browserName: "chromium",
    channel: process.env.CI ? undefined : "msedge",
    headless: true,
    viewport: { width: 1280, height: 850 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js preview --port 1420 --host 127.0.0.1",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
