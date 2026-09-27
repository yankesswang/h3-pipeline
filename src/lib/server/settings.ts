import type { Settings } from "@/lib/shared/types";
import { db } from "./db";

const DEFAULTS: Settings = {
  comfyUrl: process.env.COMFY_URL ?? "http://127.0.0.1:8188",
  llmBaseUrl: "http://127.0.0.1:1234/v1",
  llmApiKey: "",
  llmModel: "",
  llmTemperature: 0.7,
  llmDisableThinking: true,
  unloadLlmBeforeGenerate: true,
  freeComfyBeforeLlm: false,
  defaultPresetId: "qwen-general",
};

export function getSettings(): Settings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  return { ...DEFAULTS, ...stored };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const put = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const tx = db.transaction((entries: [string, unknown][]) => {
    for (const [k, v] of entries) if (k in DEFAULTS) put.run(k, JSON.stringify(v));
  });
  tx(Object.entries(patch));
  return getSettings();
}

/** Settings as sent to the browser: the API key is never echoed back. */
export function publicSettings(): Settings & { llmApiKeySet: boolean } {
  const s = getSettings();
  return { ...s, llmApiKey: "", llmApiKeySet: s.llmApiKey !== "" };
}
