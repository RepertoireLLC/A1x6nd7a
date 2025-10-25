const DEFAULT_ORT_LOG_LEVEL = "ERROR";
const DEFAULT_ORT_LOG_SEVERITY_LEVEL = "1";
const DEFAULT_GPT4ALL_LOG_LEVEL = "error";

function assignIfUnset(
  env: NodeJS.ProcessEnv,
  key: string,
  value: string
): void {
  const current = env[key];
  if (!current || !current.trim()) {
    env[key] = value;
  }
}

/**
 * GPT4All's ONNX backend is especially chatty on Windows environments, printing
 * warning-level diagnostics about pruned graph initializers that are harmless.
 * These messages surface in the user's terminal and create the impression that
 * the local model is broken.  We silence them by default while still allowing
 * deployers to opt-in to more verbose logging through environment variables.
 */
export function applyDefaultOnnxLogSettings(
  env: NodeJS.ProcessEnv = process.env
): void {
  assignIfUnset(env, "ORT_LOG_LEVEL", DEFAULT_ORT_LOG_LEVEL);
  assignIfUnset(env, "ORT_LOG_SEVERITY_LEVEL", DEFAULT_ORT_LOG_SEVERITY_LEVEL);
  assignIfUnset(env, "GPT4ALL_LOG_LEVEL", DEFAULT_GPT4ALL_LOG_LEVEL);
}

export function resetOnnxLogSettings(
  env: NodeJS.ProcessEnv = process.env
): void {
  delete env.ORT_LOG_LEVEL;
  delete env.ORT_LOG_SEVERITY_LEVEL;
  delete env.GPT4ALL_LOG_LEVEL;
}

