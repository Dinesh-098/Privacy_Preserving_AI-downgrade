import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseURL = process.env.PF_TEST_URL || "http://127.0.0.1:8766";
const data = process.env.PF_TEST_URL ? "" : mkdtempSync(join(tmpdir(), "privforensics-browser-"));

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL,
    headless: true,
    actionTimeout: 12_000,
    launchOptions: { args: ["--no-sandbox"] },
    trace: "retain-on-failure",
  },
  webServer: process.env.PF_TEST_URL ? undefined : {
    command: "./scripts/run.sh --port 8766",
    cwd: "..",
    url: baseURL + "/api/health",
    env: { PRIVFORENSICS_DATA: data },
    timeout: 45_000,
  },
});
