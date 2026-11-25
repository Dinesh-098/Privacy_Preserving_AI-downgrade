import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { join } from "node:path";

test("create a case, upload evidence, verify the hash and inspect a source record", async ({ page, baseURL }) => {
  const failures: string[] = [];
  const external: string[] = [];
  page.on("pageerror", error => failures.push(error.message));
  page.on("console", message => { if (message.type() === "error") failures.push(message.text()); });
  page.on("request", request => {
    if (request.url().startsWith("http") && new URL(request.url()).origin !== new URL(baseURL!).origin) {
      external.push(request.url());
    }
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Investigation overview" })).toBeVisible();
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(scan.violations.filter(item => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
  if (process.env.PF_STAGE_SCREENSHOTS) {
    for (const [width, height] of [[1440, 900], [1920, 1080], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: join(process.env.PF_STAGE_SCREENSHOTS, "D3", "overview-" + width + ".png") });
    }
  }
  await page.getByRole("button", { name: "New investigation", exact: true }).click();
  await page.getByLabel("Investigation title").fill("Evidence workflow check");
  await page.getByRole("button", { name: "Create investigation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Evidence workflow check" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Evidence", exact: true }).click();
  await page.getByRole("button", { name: "Register evidence", exact: true }).click();
  await page.getByRole("tab", { name: "Upload file" }).click();
  await page.getByLabel("Evidence file").setInputFiles({
    name: "auth-demo.txt", mimeType: "text/plain",
    buffer: Buffer.from("1,U1@DOM1,U1@DOM1,C1,C2,Kerberos,Network,LogOn,Success\n2,U1@DOM1,U1@DOM1,C1,C2,Kerberos,Network,LogOn,Fail\n"),
  });
  await page.getByRole("button", { name: "Register and hash" }).click();
  await page.getByRole("button", { name: "auth-demo.txt" }).click();
  await expect(page.getByRole("heading", { name: "Provenance" })).toBeVisible();
  await page.getByRole("button", { name: "Verify hash" }).click();
  await expect(page.getByRole("dialog").getByText("Verified", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Ingest this evidence" }).click();
  await page.getByRole("button", { name: "Start ingestion" }).click();
  await expect(page.getByRole("table", { name: "Validated source records" })).toBeVisible();
  await page.getByRole("button", { name: "1", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Event · line 1" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("U1@DOM1", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reveal Source account" }).click();
  await page.getByRole("button", { name: "Reveal value", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("U1@DOM1", { exact: true })).toBeVisible();
  expect(external).toEqual([]);
  expect(failures).toEqual([]);
});
