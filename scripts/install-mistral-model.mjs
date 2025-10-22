#!/usr/bin/env node

// This postinstall helper ensures the default Mistral model is present locally.
// It downloads the gguf file if it is missing and skips the work when the
// artifact already exists so repeated installs remain fast.

import { createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const BACKEND_DIR = path.resolve(ROOT_DIR, "alexandria-browser", "backend");
const DEFAULT_MODEL_DIR = path.resolve(BACKEND_DIR, "models");
const DEFAULT_MODEL_FILENAME = "mistral-7b-instruct.gguf";
const DEFAULT_MODEL_URL =
  "https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.2/resolve/main/Mistral-7B-Instruct-v0.2.Q4_K_M.gguf?download=1";

const DOWNLOAD_DISABLED =
  process.env.ALEXANDRIA_SKIP_MODEL_DOWNLOAD?.trim().toLowerCase() === "true" ||
  (process.env.CI && process.env.ALEXANDRIA_DOWNLOAD_MODEL_IN_CI?.trim().toLowerCase() !== "true");

const MODEL_DIR = process.env.ALEXANDRIA_MODEL_DIR
  ? path.resolve(ROOT_DIR, process.env.ALEXANDRIA_MODEL_DIR)
  : DEFAULT_MODEL_DIR;

const MODEL_FILENAME = process.env.ALEXANDRIA_MODEL_FILENAME?.trim() || DEFAULT_MODEL_FILENAME;
const MODEL_PATH = path.join(MODEL_DIR, MODEL_FILENAME);
const MODEL_URL = process.env.ALEXANDRIA_MODEL_URL?.trim() || DEFAULT_MODEL_URL;

async function fileIsUsable(targetPath) {
  try {
    const stats = await stat(targetPath);
    return stats.isFile() && stats.size > 0;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function ensureModelDirectory() {
  await mkdir(MODEL_DIR, { recursive: true });
}

async function downloadModel() {
  const tempPath = `${MODEL_PATH}.download-${Date.now()}`;

  try {
    const response = await fetch(MODEL_URL, {
      headers: {
        "User-Agent": "alexandria-browser/1.0 (model bootstrapper)",
        Accept: "application/octet-stream",
      },
    });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to download Mistral model: ${response.status} ${response.statusText}`);
    }

    await pipeline(response.body, createWriteStream(tempPath));
    await rename(tempPath, MODEL_PATH);
    console.log(`✓ Downloaded Mistral model to ${MODEL_PATH}`);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }

    throw error;
  }
}

async function main() {
  if (DOWNLOAD_DISABLED) {
    console.log("ℹ︎ Skipping Mistral model download (disabled via environment).");
    return;
  }

  try {
    await access(path.dirname(MODEL_PATH));
  } catch {
    await ensureModelDirectory();
  }

  if (await fileIsUsable(MODEL_PATH)) {
    console.log(`ℹ︎ Mistral model already present at ${MODEL_PATH}, skipping download.`);
    return;
  }

  console.log("ℹ︎ Mistral model not found locally. Beginning download...");
  try {
    await downloadModel();
  } catch (error) {
    console.warn(
      "⚠️  Unable to download the Mistral model automatically. AI mode will stay disabled until the file is provided.",
      error
    );
  }
}

main().catch((error) => {
  console.warn(
    "⚠️  Unexpected error while preparing the Mistral model. AI mode may remain disabled until resolved.",
    error
  );
});

