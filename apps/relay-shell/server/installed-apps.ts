/**
 * Desk-installed Relay Apps — durable records under `.data/installed-apps/`.
 * Schedule state is logical (enable/pause/disable); host arming is opt-in later.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { RelayAppBundle } from "@relay/app-bundle";

export type InstalledAppScheduleState = "disabled" | "enabled" | "paused";

export type InstalledConnectionState = {
  connected: boolean;
  connectedAt?: string;
};

export type InstalledRelayApp = {
  id: string;
  bundle: RelayAppBundle;
  installedAt: string;
  updatedAt: string;
  connections: Record<string, InstalledConnectionState>;
  scheduleState: InstalledAppScheduleState;
  /**
   * True until a complete shadow run for this Spec hash has evidence approval
   * (also set on thaw-to-edit).
   */
  needsShadowGate: boolean;
  /** Operator thawed the Spec for editing — re-freeze + evals + shadow required. */
  editing: boolean;
  lastShadowRunId?: string;
  evidenceApprovedAt?: string;
  evidenceApprovedRunId?: string;
};

export type InstalledAppSummary = {
  id: string;
  goal: string;
  specHash: string;
  scheduleState: InstalledAppScheduleState;
  needsShadowGate: boolean;
  editing: boolean;
  connectionsConnected: number;
  connectionsRequired: number;
  installedAt: string;
  updatedAt: string;
};

let storeDirOverride: string | undefined;

export function setInstalledAppsDirForTests(dir: string | undefined): void {
  storeDirOverride = dir;
}

export function installedAppsDir(): string {
  if (storeDirOverride) return storeDirOverride;
  const root = resolve(
    process.cwd(),
    process.env.RELAY_DATA_DIR?.trim() || ".data"
  );
  return join(root, "installed-apps");
}

function ensureDir(): string {
  const dir = installedAppsDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function pathFor(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(ensureDir(), `${safe}.json`);
}

export function toInstalledAppSummary(
  app: InstalledRelayApp
): InstalledAppSummary {
  const required = app.bundle.requiredConnections;
  const connected = required.filter((c) => app.connections[c]?.connected).length;
  return {
    id: app.id,
    goal: app.bundle.body.goal,
    specHash: app.bundle.specHash,
    scheduleState: app.scheduleState,
    needsShadowGate: app.needsShadowGate,
    editing: app.editing,
    connectionsConnected: connected,
    connectionsRequired: required.length,
    installedAt: app.installedAt,
    updatedAt: app.updatedAt,
  };
}

export function saveInstalledApp(app: InstalledRelayApp): void {
  writeFileSync(pathFor(app.id), JSON.stringify(app, null, 2), "utf8");
}

export function getInstalledApp(id: string): InstalledRelayApp | undefined {
  const p = pathFor(id);
  if (!existsSync(p)) return undefined;
  return JSON.parse(readFileSync(p, "utf8")) as InstalledRelayApp;
}

export function listInstalledApps(): InstalledRelayApp[] {
  const dir = ensureDir();
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const apps = files.map((f) => {
    const raw = readFileSync(join(dir, f), "utf8");
    return JSON.parse(raw) as InstalledRelayApp;
  });
  return apps.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function deleteInstalledApp(id: string): boolean {
  const p = pathFor(id);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

export function createInstalledAppFromBundle(
  bundle: RelayAppBundle,
  now = new Date().toISOString()
): InstalledRelayApp {
  const connections: Record<string, InstalledConnectionState> = {};
  for (const ref of bundle.requiredConnections) {
    connections[ref] = { connected: false };
  }
  return {
    id: bundle.id,
    bundle,
    installedAt: now,
    updatedAt: now,
    connections,
    scheduleState: "disabled",
    needsShadowGate: true,
    editing: false,
  };
}

export function allConnectionsConnected(app: InstalledRelayApp): boolean {
  const required = app.bundle.requiredConnections;
  if (!required.length) return true;
  return required.every((c) => app.connections[c]?.connected);
}
