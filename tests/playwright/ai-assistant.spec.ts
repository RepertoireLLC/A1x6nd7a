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

    const summaryText = await summaryLocator.innerText();
    expect(summaryText).toContain("Alexandria heuristics reviewed 1 result for \"Apollo 11 mission\"");
    expect(summaryText).toContain("Apollo 11 Mission Reports (1969 · Texts · NASA)");
    expect(summaryText).toMatch(/Keyword suggestions:\s*- apollo\s*- mission\s*- [\w-]+\s*- [\w-]+\s*- landing/i);
    expect(summaryText).toContain("Notable media types: Texts (1).");

    const noticeLocator = page.locator(".ai-assistant-notice");
    const noticeText = await noticeLocator.innerText();
    expect(noticeText).toMatch(/No offline AI response was available|No compatible local AI model was found/i);
    expect(noticeText).toContain("Suggestions are synthesized from the current search results.");

    const sourceBadge = page.locator(".ai-assistant-source");
    await expect(sourceBadge).toContainText(/heuristic/i);

    const statusBadge = page.locator(".ai-assistant-status");
    await expect(statusBadge).toContainText(/ready/i);
  });
});
