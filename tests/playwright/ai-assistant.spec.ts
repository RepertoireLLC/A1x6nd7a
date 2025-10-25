import { expect, test } from "@playwright/test";

const SETTINGS_KEY = "alexandria-browser-settings";
const SEEDED_SETTINGS = {
  theme: "light",
  filterNSFW: true,
  nsfwMode: "safe",
  nsfwAcknowledged: true,
  lastQuery: "",
  resultsPerPage: 20,
  mediaType: "all",
  yearFrom: "",
  yearTo: "",
  language: "",
  sourceTrust: "any",
  availability: "any",
  aiAssistantEnabled: true,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(([key, settings]) => {
    window.localStorage.setItem(key, JSON.stringify(settings));
  }, [SETTINGS_KEY, SEEDED_SETTINGS]);
});

test.describe("AI assistant heuristics", () => {
  test("surfaces heuristic summary when offline model unavailable", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading", { name: /Alexandria Browser/i })).toBeVisible({ timeout: 30000 });

    const searchBox = page.locator('input[placeholder="Seek the Alexandria archives or paste a URL"]');
    await expect(searchBox).toBeVisible({ timeout: 30000 });
    await searchBox.fill("Apollo 11 mission");
    await page.getByRole("button", { name: /initiate search/i }).click();

    const summaryLocator = page.locator(".ai-assistant-summary");
    await expect(summaryLocator).toContainText(/Alexandria heuristics reviewed|No archive items matched/i, {
      timeout: 45000,
    });
    await expect(summaryLocator).toContainText(/Keyword suggestions/i);
    await expect(summaryLocator).toContainText(/Apollo 11/i);

    const noticeLocator = page.locator(".ai-assistant-notice");
    await expect(noticeLocator).toContainText(/current search results/i);

    const sourceBadge = page.locator(".ai-assistant-source");
    await expect(sourceBadge).toContainText(/heuristic/i);

    const statusBadge = page.locator(".ai-assistant-status");
    await expect(statusBadge).toContainText(/ready/i);
  });
});
