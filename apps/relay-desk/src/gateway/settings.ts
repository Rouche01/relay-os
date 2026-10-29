import { DEFAULT_SETTINGS, type DeskSettings } from "./types.ts";

const KEY = "relay-desk.settings.v1";

export function loadSettings(): DeskSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<DeskSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      gatewayUrl: String(parsed.gatewayUrl ?? DEFAULT_SETTINGS.gatewayUrl).trim(),
      apiToken: String(parsed.apiToken ?? DEFAULT_SETTINGS.apiToken),
      jobId: String(parsed.jobId ?? DEFAULT_SETTINGS.jobId).trim() || "relay-desk",
      agentId:
        String(parsed.agentId ?? DEFAULT_SETTINGS.agentId).trim() || "relay-desk",
      ttlSec: Number(parsed.ttlSec) > 0 ? Number(parsed.ttlSec) : 600,
      hitlUrl: String(parsed.hitlUrl ?? DEFAULT_SETTINGS.hitlUrl).trim(),
      hitlToken: String(parsed.hitlToken ?? DEFAULT_SETTINGS.hitlToken),
      specApiUrl: String(parsed.specApiUrl ?? DEFAULT_SETTINGS.specApiUrl).trim(),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: DeskSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
