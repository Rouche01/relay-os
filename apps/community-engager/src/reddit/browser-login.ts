import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Page } from "playwright";
import { getRedditEnv, type RedditEnvConfig } from "./config.js";
import { createRedditBrowserEngine } from "./browser-session.js";
import {
  deleteSessionCookies,
  saveSession,
  storageStatePath,
} from "./cookies.js";

export const REDDIT_LOGIN_URL = "https://www.reddit.com/login/";

export interface BrowserLoginOptions {
  cfg?: RedditEnvConfig;
  /** Override env username (HITL credential feedback). */
  username?: string;
  /** Override env password (HITL credential feedback). */
  password?: string;
  /**
   * Headed recommended for first login / 2FA.
   * Default follows cfg.browserHeadless; set REDDIT_LOGIN_HEADED=true to force headed.
   */
  headless?: boolean;
  /** Clear existing jar before login (AUTH refresh). Default true. */
  clearJar?: boolean;
  /**
   * Called when login hits a challenge / 2FA / CAPTCHA wall.
   * Default: CLI readline pause. Telegram path: complete in headed browser while we poll.
   */
  onChallenge?: (info: { url: string; hint: string }) => Promise<void>;
  /** Max ms to wait after credentials for success or challenge. */
  postSubmitTimeoutMs?: number;
  /** Max ms to wait after human challenge pause. */
  challengeTimeoutMs?: number;
}

export interface BrowserLoginResult {
  ok: boolean;
  storagePath?: string;
  url?: string;
  error?: string;
  challenged?: boolean;
}

const CHALLENGE_RE =
  /\b(verify|verification|check code|one-time|otp|captcha|challenge|suspicious|confirm it.?s you)\b/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function dismissCookieBanner(page: Page): Promise<void> {
  try {
    await page
      .getByRole("button", { name: /Accept All|Reject Optional Cookies/i })
      .first()
      .click({ timeout: 2500 });
  } catch {
    /* no banner */
  }
}

/** Username field on Reddit's login form (full page or modal). */
function usernameField(page: Page) {
  return page.getByRole("textbox", { name: /email or username/i });
}

/**
 * Ensure the headed page shows Reddit's login form.
 * Clicks nav/modal "Log In" when possible; otherwise navigates to /login/.
 */
export async function openRedditLoginForm(page: Page): Promise<void> {
  await dismissCookieBanner(page);

  const userBox = usernameField(page);
  try {
    if (await userBox.isVisible({ timeout: 1_500 })) return;
  } catch {
    /* need to open form */
  }

  try {
    const loginCtl = page
      .getByRole("link", { name: /^Log In$/i })
      .or(page.getByRole("button", { name: /^Log In$/i }))
      .or(page.locator('a[href*="/login"]').first())
      .first();
    await loginCtl.click({ timeout: 5_000 });
    await userBox.waitFor({ state: "visible", timeout: 15_000 });
    return;
  } catch {
    /* fall through to dedicated login URL */
  }

  console.log(`[login] opening ${REDDIT_LOGIN_URL}`);
  await page.goto(REDDIT_LOGIN_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await dismissCookieBanner(page);
  await userBox.waitFor({ state: "visible", timeout: 20_000 });
}

/** Fill username/password on the current page and click Log In. */
export async function fillAndSubmitRedditLogin(
  page: Page,
  username: string,
  password: string
): Promise<void> {
  await openRedditLoginForm(page);
  const userBox = usernameField(page);
  await userBox.fill(username);
  const passBox = page.locator('input[type="password"]').first();
  await passBox.waitFor({ state: "visible", timeout: 10_000 });
  await passBox.fill(password);
  await page.getByRole("button", { name: /^Log In$/i }).click();
}

/** Poll until cookies/UI look logged-in, or timeout. */
export async function waitUntilRedditLoggedIn(
  page: Page,
  timeoutMs = 45_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await looksLoggedIn(page)) return true;
    await sleep(500);
  }
  return looksLoggedIn(page);
}

async function pauseForHumanCli(info: {
  url: string;
  hint: string;
}): Promise<void> {
  console.warn(`\n[login] Challenge / extra step detected.`);
  console.warn(`[login] ${info.hint}`);
  console.warn(`[login] Current URL: ${info.url}`);
  console.warn(
    `[login] Complete the step in the browser window, then press Enter here.\n`
  );
  const rl = createInterface({ input, output });
  try {
    await rl.question("Press Enter when logged in… ");
  } finally {
    rl.close();
  }
}

async function looksLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  const onLogin = /\/login/i.test(url);

  const cookies = await page.context().cookies("https://www.reddit.com");
  const sessionish = cookies.some((c) =>
    /^(reddit_session|token_v2)$/i.test(c.name)
  );

  if (!onLogin && sessionish) return true;
  if (!onLogin) {
    try {
      const create = page.getByRole("button", { name: /Create Post|Create/i });
      if ((await create.count()) > 0 && (await create.first().isVisible())) {
        return true;
      }
    } catch {
      /* ignore */
    }
  }

  return false;
}

async function detectChallenge(page: Page): Promise<string | null> {
  const url = page.url();
  let text = "";
  try {
    text = (await page.locator("body").innerText()).slice(0, 4000);
  } catch {
    text = "";
  }
  if (CHALLENGE_RE.test(text) || CHALLENGE_RE.test(url)) {
    const m = text.match(CHALLENGE_RE);
    return `UI suggests a challenge (${m?.[0] ?? "verify"}). Finish it manually.`;
  }
  if (/\/login/i.test(url)) {
    try {
      const err = page.locator(
        "#loginPassword-error, [slot='error'], faceplate-banner"
      );
      if ((await err.count()) > 0) {
        const msg = (await err.first().innerText()).trim();
        if (msg && !/log in|sign up|cookie/i.test(msg)) return msg;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function persistSuccess(
  page: Page,
  cfg: RedditEnvConfig,
  challenged?: boolean
): Promise<BrowserLoginResult> {
  const saved = await saveSession(page, cfg);
  console.log(
    `[login] success${challenged ? " after challenge" : ""} → ${saved.storagePath}`
  );
  return {
    ok: true,
    storagePath: saved.storagePath,
    url: page.url(),
    challenged,
  };
}

/**
 * Reddit browser login (semantic locators) → persist storageState cookie jar.
 * Clears jar first (AUTH). On 2FA/CAPTCHA, pauses via onChallenge (CLI by default).
 * Vision agents are intentionally not wired here — escape hatch for later.
 */
export async function loginRedditBrowser(
  opts: BrowserLoginOptions = {}
): Promise<BrowserLoginResult> {
  const cfg = opts.cfg ?? getRedditEnv();
  const username = (opts.username ?? cfg.username)?.trim();
  const password = opts.password ?? cfg.password;
  if (!username || !password) {
    return {
      ok: false,
      error:
        "Reddit username and password required (HITL credential feedback or REDDIT_USERNAME / REDDIT_PASSWORD)",
    };
  }
  const clearJar = opts.clearJar ?? true;
  const postSubmitTimeoutMs = opts.postSubmitTimeoutMs ?? 20_000;
  const challengeTimeoutMs = opts.challengeTimeoutMs ?? 300_000;

  const headedEnv =
    process.env.REDDIT_LOGIN_HEADED === "true" ||
    process.env.REDDIT_LOGIN_HEADED === "1";
  const headless = opts.headless ?? (headedEnv ? false : cfg.browserHeadless);

  if (clearJar) {
    await deleteSessionCookies(cfg);
  }

  const { engine } = await createRedditBrowserEngine({
    cfg,
    useStoredSession: false,
    headless,
  });

  const onChallenge = opts.onChallenge ?? pauseForHumanCli;

  try {
    const page = await engine.getPage();
    console.log(`[login] → ${REDDIT_LOGIN_URL} (headless=${headless})`);
    await fillAndSubmitRedditLogin(page, username, password);

    let challenged = false;
    const deadline = Date.now() + postSubmitTimeoutMs;
    while (Date.now() < deadline) {
      if (await looksLoggedIn(page)) {
        return persistSuccess(page, cfg);
      }
      const hint = await detectChallenge(page);
      if (hint) {
        challenged = true;
        await onChallenge({ url: page.url(), hint });
        break;
      }
      await sleep(500);
    }

    if (await looksLoggedIn(page)) {
      return persistSuccess(page, cfg, challenged);
    }

    // Still not in — ask human if we haven't already (slow login / silent wall)
    if (!challenged) {
      challenged = true;
      await onChallenge({
        url: page.url(),
        hint:
          (await detectChallenge(page)) ??
          "Login not confirmed yet — complete any CAPTCHA/2FA in the browser.",
      });
    }

    const challengeDeadline = Date.now() + challengeTimeoutMs;
    while (Date.now() < challengeDeadline) {
      if (await looksLoggedIn(page)) {
        return persistSuccess(page, cfg, true);
      }
      await sleep(1000);
    }

    // Last chance: home page cookie check
    await page.goto("https://www.reddit.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    if (await looksLoggedIn(page)) {
      return persistSuccess(page, cfg, challenged);
    }

    return {
      ok: false,
      challenged,
      url: page.url(),
      error:
        "Login did not complete — check credentials, try REDDIT_LOGIN_HEADED=true for 2FA/CAPTCHA",
      storagePath: storageStatePath(cfg),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      storagePath: storageStatePath(cfg),
    };
  } finally {
    await engine.teardown();
  }
}
