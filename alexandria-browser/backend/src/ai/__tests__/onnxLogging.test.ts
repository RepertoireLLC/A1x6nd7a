import { describe, expect, it } from "vitest";

import {
  applyDefaultOnnxLogSettings,
  resetOnnxLogSettings,
} from "../onnxLogging";

function createEnv(): NodeJS.ProcessEnv {
  return {} as NodeJS.ProcessEnv;
}

describe("applyDefaultOnnxLogSettings", () => {
  it("populates fallback values when variables are unset", () => {
    const env = createEnv();

    applyDefaultOnnxLogSettings(env);

    expect(env.ORT_LOG_LEVEL).toBe("ERROR");
    expect(env.ORT_LOG_SEVERITY_LEVEL).toBe("1");
    expect(env.GPT4ALL_LOG_LEVEL).toBe("error");
  });

  it("preserves explicit overrides supplied by the host environment", () => {
    const env = createEnv();
    env.ORT_LOG_LEVEL = "WARNING";
    env.ORT_LOG_SEVERITY_LEVEL = "2";
    env.GPT4ALL_LOG_LEVEL = "warning";

    applyDefaultOnnxLogSettings(env);

    expect(env.ORT_LOG_LEVEL).toBe("WARNING");
    expect(env.ORT_LOG_SEVERITY_LEVEL).toBe("2");
    expect(env.GPT4ALL_LOG_LEVEL).toBe("warning");
  });

  it("clears the variables when asked so tests can restore defaults", () => {
    const env = createEnv();

    applyDefaultOnnxLogSettings(env);
    resetOnnxLogSettings(env);

    expect(env.ORT_LOG_LEVEL).toBeUndefined();
    expect(env.ORT_LOG_SEVERITY_LEVEL).toBeUndefined();
    expect(env.GPT4ALL_LOG_LEVEL).toBeUndefined();
  });
});

