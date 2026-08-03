import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/v1/cases**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/v1/search**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
});

test("landing page shows product promise and opens workspace", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /find the exact span that broke an agent workflow/i })).toBeVisible();
  await expect(page.getByText(/live web evidence fetch/i)).toBeVisible();
  await page.getByRole("link", { name: /open workspace/i }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("heading", { name: "Faultspan" })).toBeVisible();
  await expect(page.getByLabel(/live configuration/i)).toBeVisible();
});

test("overview exposes live contract configuration and evidence workspace", async ({ page }) => {
  await page.goto("/overview");
  await expect(page.getByRole("button", { name: /create real case/i })).toBeVisible();
  // A real 0x address, not "unknown"/"not configured" -- deliberately not
  // pinned to one literal address, since that goes stale on every redeploy
  // (this bit us once already).
  await expect(page.getByLabel(/live configuration/i)).toContainText(/0x[a-fA-F0-9]{6}/);
  await page.goto("/evidence");
  await expect(page.getByRole("heading", { name: /^evidence$/i })).toBeVisible();
  await expect(page.getByText(/ipfs evidence vault/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /add evidence/i })).toBeVisible();
});
