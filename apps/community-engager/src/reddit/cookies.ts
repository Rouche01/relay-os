import { mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Cookie, Page } from "playwright";
import type { RedditEnvConfig } from "./config.js";

/**
 * Playwright storageState shape (cookies + localStorage origins).
 * Primary on-disk format for Reddit browser sessions.
 */
export interface RedditStorageState {
  cookies: Cookie[];
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

export interface CookieJarOptions {
  cookieDir?: string;
  /** Account key — defaults to username or "default". */
  account?: string;
}

/** Sanitize account for a filesystem-safe filename. */
export function sanitizeAccountId(account: string): string {
  const cleaned = account.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
  return cleaned || "default";
}

export function resolveAccountId(
  cfg: Pick<RedditEnvConfig, "username">,
  override?: string
): string {
  return sanitizeAccountId(override ?? cfg.username ?? "default");
}

/** Path to Playwright storageState JSON for an account. */
export function storageStatePath(
  cfg: Pick<RedditEnvConfig, "cookieDir" | "username">,
  account?: string
): string {
  const id = resolveAccountId(cfg, account);
  return path.join(cfg.cookieDir, `${id}.storage.json`);
}

/** HITL-style cookies-only dump (debug / migration). */
export function cookiesDebugPath(
  cfg: Pick<RedditEnvConfig, "cookieDir" | "username">,
  account?: string
): string {
  const id = resolveAccountId(cfg, account);
  return path.join(cfg.cookieDir, `${id}.cookies.json`);
}

export async function hasStorageState(
  cfg: Pick<RedditEnvConfig, "cookieDir" | "username">,
  account?: string
): Promise<boolean> {
  try {
    await access(storageStatePath(cfg, account));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load Playwright storageState from disk.
 * Returns null if missing or invalid (fail-open for callers).
 */
export async function loadStorageState(
  cfg: Pick<RedditEnvConfig, "cookieDir" | "username">,
  account?: string
): Promise<RedditStorageState | null> {
  const filePath = storageStatePath(cfg, account);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as RedditStorageState;
    if (!parsed || !Array.isArray(parsed.cookies)) {
      console.warn(`[cookies] invalid storageState at ${filePath}`);
      return null;
    }
    return {
      cookies: parsed.cookies,
      origins: Array.isArray(parsed.origins) ? parsed.origins : [],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/ENOENT|no such file/i.test(msg)) {
      console.warn(`[cookies] unable to load storageState: ${msg}`);
    }
    return null;
  }
}

/**
 * Persist context storageState (primary) + cookies-only debug dump (HITL-style).
 */
export async function saveSession(
  source: BrowserContext | Page,
  cfg: Pick<RedditEnvConfig, "cookieDir" | "username">,
  account?: string
): Promise<{ storagePath: string; cookiesPath: string }> {
  await mkdir(cfg.cookieDir, { recursive: true });
  const storagePath = storageStatePath(cfg, account);
  const cookiesPath = cookiesDebugPath(cfg, account);

  const context =
    "context" in source && typeof (source as Page).context === "function"
      ? (source as Page).context()
      : (source as BrowserContext);

  await context.storageState({ path: storagePath });

  const cookies = await context.cookies();
  await writeFile(cookiesPath, JSON.stringify(cookies, null, 2), "utf8");

  console.log(`[cookies] saved storageState → ${storagePath}`);
  return { storagePath, cookiesPath };
}

/** Alias matching HITL naming. */
export async function saveSessionCookies(
  source: BrowserContext | Page,
  cfg: Pick<RedditEnvConfig, "cookieDir" | "username">,
  account?: string
): Promise<void> {
  await saveSession(source, cfg, account);
}

/**
 * Retrieve cookies array (from storageState or legacy cookies-only file).
 * HITL-compatible helper for debugging / addCookies.
 */
export async function retrieveSessionCookies(
  cfg: Pick<RedditEnvConfig, "cookieDir" | "username">,
  account?: string
): Promise<Cookie[] | null> {
  const state = await loadStorageState(cfg, account);
  if (state?.cookies?.length) return state.cookies;

  const debugPath = cookiesDebugPath(cfg, account);
  try {
    const raw = await readFile(debugPath, "utf8");
    const parsed = JSON.parse(raw) as Cookie[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Delete storageState + cookies debug dump (AUTH refresh / logout). */
export async function deleteSessionCookies(
  cfg: Pick<RedditEnvConfig, "cookieDir" | "username">,
  account?: string
): Promise<void> {
  const paths = [storageStatePath(cfg, account), cookiesDebugPath(cfg, account)];
  for (const p of paths) {
    try {
      await rm(p, { force: true });
      console.log(`[cookies] deleted ${p}`);
    } catch (err) {
      console.warn(
        `[cookies] unable to delete ${p}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

/**
 * Apply a loaded storageState (or cookies-only) onto an open context.
 * Prefer launching with storageState when possible; this is for mid-session inject.
 */
export async function applyCookiesToContext(
  context: BrowserContext,
  cookies: Cookie[]
): Promise<void> {
  if (!cookies.length) return;
  await context.addCookies(cookies);
}
