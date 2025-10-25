import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAskAI = vi.fn(async (_prompt: string, _options?: Record<string, unknown>) => "");
const mockInitAI = vi.fn(async () => {});
const mockConfigureModels = vi.fn();
const mockEmbedText = vi.fn(async () => []);

vi.mock("../../../ai/engine", () => ({
  askAI: mockAskAI,
  initAI: mockInitAI,
  configureModels: mockConfigureModels,
  embedText: mockEmbedText,
}));

async function loadModule() {
  return import("../LocalAI");
}

describe("LocalAI integration behavior", () => {
  beforeEach(() => {
    mockAskAI.mockReset();
    mockInitAI.mockReset();
    mockConfigureModels.mockReset();
    mockEmbedText.mockReset();

    mockAskAI.mockResolvedValue("Prompt\nAI: hello");
    mockInitAI.mockResolvedValue(undefined);
    mockEmbedText.mockResolvedValue([]);

    vi.resetModules();
  });

  it("returns disabled outcome and skips generation when AI is disabled", async () => {
    const localAI = await loadModule();

    const outcome = localAI.configureLocalAI({ enabled: false });
    expect(outcome.status).toBe("disabled");

    const response = await localAI.generateContextualResponse({
      mode: "search",
      message: "Explain the Alexandria Browser",
      nsfwMode: "safe",
    });

    expect(response).toBeNull();
    expect(localAI.getLastAIOutcome().status).toBe("disabled");
    expect(mockAskAI).not.toHaveBeenCalled();
  });

  it("suppresses explicit prompts in safe mode and records an informational outcome", async () => {
    const localAI = await loadModule();
    localAI.configureLocalAI({ enabled: true });

    const response = await localAI.generateContextualResponse({
      mode: "search",
      message: "Find porn archives",
      nsfwMode: "safe",
    });

    expect(response).toContain("AI Mode: This content is hidden because Safe mode is enabled");
    expect(localAI.getLastAIOutcome()).toMatchObject({ status: "success" });
    expect(mockAskAI).not.toHaveBeenCalled();
  });

  it("gracefully reports errors when the underlying model is unavailable", async () => {
    mockAskAI.mockRejectedValueOnce(new Error("model missing"));

    const localAI = await loadModule();
    localAI.configureLocalAI({ enabled: true });

    const reply = await localAI.generateContextualResponse({
      mode: "chat",
      message: "Summarize the latest search results",
      nsfwMode: "unrestricted",
    });

    expect(reply).toBeNull();

    const outcome = localAI.getLastAIOutcome();
    expect(outcome.status).toBe("error");
    expect(outcome.message).toMatch(/.+/);
    expect(mockInitAI).toHaveBeenCalled();
    expect(mockAskAI).toHaveBeenCalledTimes(1);
  });
});
