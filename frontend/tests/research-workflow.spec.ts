import { expect, test, type APIRequestContext } from "@playwright/test";

async function load<T>(request: APIRequestContext, path: string): Promise<T> {
  const reply = await request.get(path);
  expect(reply.ok(), await reply.text()).toBeTruthy();
  return reply.json() as Promise<T>;
}

test("connect a finding, protection, baseline, DP comparison, leakage and a downloaded report", async ({ page, request }) => {
  test.setTimeout(115_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Load example case" }).click();
  await expect(page.getByRole("heading", { name: "Authentication review · Example fixture" })).toBeVisible();
  const caseId = new URL(page.url()).searchParams.get("case")!;
  type Source = { id: string; kind: string; rows: number };
  await expect.poll(async () => (await load<Source[]>(request, "/api/cases/" + caseId + "/datasets")).length).toBe(4);
  const datasets = await load<Source[]>(request, "/api/cases/" + caseId + "/datasets");
  const reference = datasets.find(item => item.kind === "redteam")!;
  const synthetic = datasets.find(item => item.kind === "synthetic")!;
  const suffix = "?case=" + caseId;

  await page.goto("/correlation" + suffix + "&dataset=" + reference.id + "&line=1");
  await expect(page.getByRole("heading", { name: "Event timeline" })).toBeVisible();
  await expect(page.getByText("Exact time, source account and ordered host pair.")).toBeVisible();
  await page.getByRole("button", { name: "Save finding", exact: true }).click();
  await page.getByLabel("Finding title").fill("Confirmed generated reference");
  await page.getByRole("button", { name: "Save to investigation" }).click();
  await expect(page.getByRole("table", { name: "Saved evidence-linked findings" })).toContainText("Confirmed generated reference");

  await page.goto("/privacy" + suffix + "&dataset=" + synthetic.id);
  await expect(page.getByRole("table", { name: "Sensitive-field detectors" })).toContainText("Email");
  await page.getByRole("link", { name: "Configure privacy protection" }).click();
  await page.getByRole("button", { name: "Generate key", exact: true }).click();
  await expect(page.getByText("Configured", { exact: true })).toBeVisible();
  await page.getByLabel("Source account", { exact: true }).selectOption("hmac");
  await page.getByRole("button", { name: "Preview protection" }).click();
  await expect(page.locator(".transform")).toContainText("account_");
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(page.getByText("Saved policy", { exact: true })).toBeVisible();
  await page.getByLabel("Maximum rows to export").fill("20");
  await page.getByRole("button", { name: "Export protected CSV" }).click();
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  expect((await csv).suggestedFilename()).toContain("-protected.csv");

  await page.getByRole("link", { name: "Evaluate privacy and utility" }).click();
  await expect(page.getByLabel("Protection method")).toHaveValue("E0");
  await expect(page.getByLabel("Maximum records")).toHaveCount(0);
  await page.getByRole("button", { name: "Run experiment", exact: true }).click();
  await expect(page.getByRole("status", { name: "Run status" })).toContainText("Results saved.", { timeout: 25_000 });
  const comparison = page.getByRole("table", { name: "Experiment metrics comparison" });
  await expect(comparison).toContainText("F1 score");
  await expect(comparison).toContainText("Account linkage");
  await expect(comparison).toContainText("Training time");
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await page.getByLabel("Maximum records").fill("1500");
  await page.getByLabel("Number of trees").fill("18");
  await page.getByRole("button", { name: "Run experiment", exact: true }).click();
  await expect(page.getByRole("table", { name: "Experiment metrics comparison" })).toContainText("E0 · Baseline");
  await page.getByRole("button", { name: "E4 DP-SGD" }).click();
  await page.getByLabel("Epochs").fill("3");
  await page.getByRole("button", { name: "Run experiment", exact: true }).click();
  await expect(page.getByRole("table", { name: "Experiment metrics comparison" })).toContainText("E4 · DP-SGD", { timeout: 30_000 });
  await expect(page.getByText("Each reported budget comes from Opacus RDP", { exact: false })).toBeVisible();
  await page.getByRole("tab", { name: "Curves" }).click();
  await expect(page.getByRole("heading", { name: "Receiver operating characteristic" })).toBeVisible();
  await page.getByRole("tab", { name: "Frontier" }).click();
  await expect(page.getByRole("heading", { name: "F1 versus epsilon" })).toBeVisible();
  await page.getByRole("tab", { name: "Reproduce" }).click();
  await expect(page.getByRole("heading", { name: "Run manifest" })).toHaveCount(2);

  await page.getByRole("link", { name: "Attack simulation", exact: true }).click();
  await expect(page.getByRole("table", { name: "Membership experiment measures" })).toBeVisible();
  await page.getByRole("tab", { name: "Re-identification" }).click();
  await page.getByRole("button", { name: "Run linkage benchmark" }).click();
  await expect(page.getByRole("table", { name: "Original, masked and pseudonymized linkage" })).toContainText("HMAC pseudonymized");

  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await page.getByRole("button", { name: "Privacy–utility evaluation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Differential privacy accounting" })).toBeVisible();
  await page.getByRole("button", { name: "Generate report", exact: true }).click();
  const artifact = page.waitForEvent("download");
  await page.getByRole("button", { name: "Generate and download" }).click();
  expect((await artifact).suggestedFilename()).toMatch(/^REP-[A-F0-9]+\.pdf$/);
  await expect(page.getByRole("table", { name: "Generated report history" })).toContainText("Privacy–utility evaluation");
  await page.getByRole("link", { name: "Audit history", exact: true }).click();
  await page.getByRole("button", { name: "Verify chain" }).click();
  await expect(page.getByText(/Verified \d+ linked audit entries/)).toBeVisible();
  expect(errors).toEqual([]);
});
