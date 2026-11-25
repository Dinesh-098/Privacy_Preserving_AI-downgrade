import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { join } from "node:path";

const routes = [
  ["/", "Investigation overview", "D4"], ["/investigations", "Investigations", "D4"],
  ["/evidence", "Evidence management", "D4"], ["/datasets", "Dataset explorer", "D4"],
  ["/correlation", "Event correlation", "D5"], ["/privacy", "Privacy analysis", "D6"],
  ["/protection", "Privacy protection", "D6"], ["/analysis", "AI forensic analysis", "D7"],
  ["/lab", "Privacy–Utility Lab", "D7"], ["/attacks", "Attack simulation", "D7"],
  ["/performance", "Performance analysis", "D7"], ["/reports", "Reports", "D8"],
  ["/audit", "Audit history", "D8"], ["/settings", "Settings", "D8"], ["/design-system", "Design system", "D2"],
] as const;
const dimensions = [[1440, 900], [1920, 1080], [1280, 800], [1280, 720]] as const;

async function api<T>(request: APIRequestContext, path: string, payload?: object): Promise<T> {
  const reply = payload ? await request.post(path, { data: payload }) : await request.get(path);
  expect(reply.ok(), await reply.text()).toBeTruthy();
  return reply.json() as Promise<T>;
}

async function done(request: APIRequestContext, id: string) {
  await expect.poll(async () => (await api<{ status: string }>(request, "/api/jobs/" + id)).status,
    { timeout: 35_000 }).toBe("completed");
}

test("every route works with empty and populated data, local assets and accessible contrast", async ({ page, request, baseURL }) => {
  const shots = process.env.PF_STAGE_SCREENSHOTS;
  test.setTimeout(shots ? 360_000 : 145_000);
  const issues: string[] = [];
  const traffic: string[] = [];
  page.on("pageerror", issue => issues.push(issue.message));
  page.on("console", message => { if (message.type() === "error") issues.push(message.text()); });
  page.on("request", req => {
    if (req.url().startsWith("http") && new URL(req.url()).origin !== new URL(baseURL!).origin) traffic.push(req.url());
  });
  const example = await api<{ id: string }>(request, "/api/cases", { title: "Browser QA · Example fixture" });
  const base = "/api/cases/" + example.id;
  await done(request, (await api<{ id: string }>(request, base + "/demo", {})).id);
  const datasets = await api<{ id: string; kind: string }[]>(request, base + "/datasets");
  const synth = datasets.find(item => item.kind === "synthetic")!;
  const red = datasets.find(item => item.kind === "redteam")!;
  await api(request, "/api/keys", { rotate: false });
  for (const [model, mechanism] of [["neural", "E0"], ["dp_neural", "E4"]]) {
    const job = await api<{ id: string }>(request, base + "/runs", {
      dataset_id: synth.id, max_rows: 2400, epochs: 8, model, mechanism,
    });
    await done(request, job.id);
  }
  await api(request, base + "/reports", { type: "evaluation", format: "pdf", confirmed: true });
  for (const theme of ["dark", "light"]) {
    for (const fixture of [false, true]) {
      await page.goto("/");
      await page.evaluate(theme => {
        localStorage.removeItem("pf-last-case");
        localStorage.setItem("pf-theme", JSON.stringify(theme));
        localStorage.setItem("pf-reduced", "true");
      }, theme);
      for (const [route, title, stage] of routes) {
        let path: string = route;
        if (fixture) {
          path += "?case=" + example.id;
          if (route === "/correlation") path += "&dataset=" + red.id + "&line=1";
          if (["/datasets", "/privacy", "/protection", "/analysis", "/lab", "/attacks"].includes(route)) path += "&dataset=" + synth.id;
          if (route === "/reports") path += "&type=evaluation";
        } else {
          await page.evaluate(() => localStorage.removeItem("pf-last-case"));
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(path);
        await expect(page.getByRole("main").getByRole("heading", { name: title, exact: true, level: 1 })).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.getByText("Backend connected", { exact: true })).toBeVisible();
        if (fixture) {
          if (route === "/correlation") await expect(page.getByText("Exact time, source account and ordered host pair.")).toBeVisible();
          if (route === "/protection") await expect(page.getByRole("table", { name: "Redacted before and after sample" })).toBeVisible();
          if (route === "/lab") await expect(page.getByRole("table", { name: "Experiment metrics comparison" })).toBeVisible();
        }
        await page.evaluate(() => document.fonts.ready);
        const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        const serious = result.violations.filter(issue => ["serious", "critical"].includes(issue.impact ?? ""));
        expect(serious.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) })), theme + " " + path).toEqual([]);
        if (shots) {
          for (const [width, height] of dimensions) {
            await page.setViewportSize({ width, height });
            await page.screenshot({ path: join(shots, stage, (route.slice(1) || "overview") + "-" +
              theme + "-" + (fixture ? "example" : "empty") + "-" + width + "x" + height + ".png"), animations: "disabled" });
          }
          if (route === "/lab" && fixture && theme === "dark") {
            await page.setViewportSize({ width: 1440, height: 900 });
            await page.getByRole("button", { name: "Advanced", exact: true }).click();
            await page.getByRole("tab", { name: "Frontier" }).click();
            await expect(page.getByRole("heading", { name: "Measured privacy–utility frontier" })).toBeVisible();
            await page.screenshot({ path: join(shots, "D9", "lab-frontier-dark-1440x900.png"), animations: "disabled" });
            await page.getByRole("button", { name: "Simple", exact: true }).click();
          }
        }
      }
    }
  }
  expect(traffic).toEqual([]);
  expect(issues).toEqual([]);
});

test("keyboard search, appearance and presentation mode", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Search workspace" })).toBeVisible();
  await page.getByLabel("Find a page or record").fill("settings");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption("light");
  await page.getByLabel("Reduce motion").check();
  await page.getByRole("checkbox", { name: "Presentation mode", exact: true }).check();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-reduced", "true");
  await expect(page.locator("html")).toHaveAttribute("data-presentation", "true");
  await page.keyboard.press("g");
  await page.keyboard.press("o");
  await expect(page.getByRole("heading", { name: "Investigation overview" })).toBeVisible();
});
