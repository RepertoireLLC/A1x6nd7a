import { expect, test } from "@playwright/test";

const SETTINGS_KEY = "alexandria-browser-settings";

const BASE_SETTINGS = {
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
  collection: "",
  uploader: "",
  subject: "",
  aiAssistantEnabled: false,
};

async function seedSettings(page, overrides: Partial<typeof BASE_SETTINGS>) {
  await page.addInitScript(([key, defaults, custom]) => {
    const payload = { ...defaults, ...(custom ?? {}) };
    window.localStorage.setItem(key, JSON.stringify(payload));
  }, [SETTINGS_KEY, BASE_SETTINGS, overrides ?? {}]);
}

test.describe("AI search interpretation", () => {
  const query = "Show me encyclopedia britannica volumes before 1920";

  test("uses literal query when AI mode is disabled", async ({ page }) => {
    await seedSettings(page, { aiAssistantEnabled: false });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading", { name: /Alexandria Browser/i })).toBeVisible({ timeout: 30000 });

    const searchBox = page.getByPlaceholder("Seek the Alexandria archives or paste a URL");
    await expect(searchBox).toBeVisible({ timeout: 30000 });

    const responsePromise = page
      .waitForResponse((response) =>
        response.url().includes("/api/searchArchive") && response.request().method() === "GET"
      )
      .then((response) => response.json());

    await searchBox.fill(query);

    const payload = (await responsePromise) as {
      finalQuery?: string;
      refinedByAI?: boolean;
    };

    expect(payload.finalQuery).toBe(query);
    expect(payload.refinedByAI).toBeFalsy();

    const aiPanelHeading = page.getByRole("heading", { name: /AI Search Interpretation/i });
    await expect(aiPanelHeading).toHaveCount(0);
    await expect(page.getByText(/Alexandria is searching for/i)).toHaveCount(0);
  });

  test("surfaces interpreted query when AI mode is enabled", async ({ page }) => {
    await seedSettings(page, { aiAssistantEnabled: true });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByRole("heading", { name: /Alexandria Browser/i })).toBeVisible({ timeout: 30000 });

    const searchBox = page.getByPlaceholder("Seek the Alexandria archives or paste a URL");
    await expect(searchBox).toBeVisible({ timeout: 30000 });

    const responsePromise = page
      .waitForResponse((response) =>
        response.url().includes("/api/searchArchive") && response.request().method() === "GET"
      )
      .then((response) => response.json());

    await searchBox.fill(query);

    const payload = (await responsePromise) as {
      finalQuery?: string;
      refinedByAI?: boolean;
      archive?: { ai_applied_filters?: Record<string, string> | null };
    };

    expect(payload.finalQuery).toBe("encyclopedia britannica volumes");
    expect(payload.refinedByAI).toBeTruthy();

    const aiPanelHeading = page.getByRole("heading", { name: /AI Search Interpretation/i });
    await expect(aiPanelHeading).toBeVisible({ timeout: 30000 });

    await expect(
      page.getByText(/Alexandria is searching for\s+.*encyclopedia britannica volumes/i)
    ).toBeVisible({ timeout: 30000 });

    await expect(page.getByText(/“encyclopedia britannica volumes”/i)).toBeVisible({ timeout: 30000 });

    if (payload.archive?.ai_applied_filters) {
      await expect(page.getByText(/AI-applied filters/i)).toBeVisible({ timeout: 30000 });
      await expect(page.getByText(/Latest year/i)).toBeVisible();
    }
  });
});
