import type { Page } from "playwright";
import type { DecisionPort } from "@relay/engines-decide";
import { createDecisionPort } from "@relay/engines-decide";
import {
  actComposerControl,
  decideComposerControl,
  resolveComposerLocator,
} from "../../decide/composer-decide.js";
import { getCommunityConfig, type CommunityRuntimeConfig } from "../config.js";
import { createRedditBrowserEngine } from "../session/browser-session.js";
import { loginRedditBrowser } from "../session/browser-login.js";
import { hasStorageState, saveSession } from "../session/cookies.js";

export interface BrowserCommentOptions {
  threadUrl: string;
  text: string;
  cfg?: CommunityRuntimeConfig;
  /** If jar missing / auth wall, run loginRedditBrowser first. Default true when hasUserPass. */
  loginIfNeeded?: boolean;
  headless?: boolean;
  /** Composer-control DecisionPort (default createDecisionPort). */
  decide?: DecisionPort;
  /** Internal: auth-wall re-login attempts remaining. */
  _authRetries?: number;
}

export interface BrowserCommentResult {
  ok: boolean;
  permalink?: string;
  error?: string;
  loggedIn?: boolean;
}

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

async function isAuthWall(page: Page): Promise<boolean> {
  const url = page.url();
  if (/\/login/i.test(url)) return true;
  try {
    const login = page.getByRole("link", { name: /^Log In$/i });
    const composer = page.locator("shreddit-composer, [contenteditable='true']");
    const hasLogin = (await login.count()) > 0 && (await login.first().isVisible());
    const hasComposer = (await composer.count()) > 0;
    return hasLogin && !hasComposer;
  } catch {
    return false;
  }
}

/**
 * Open the comment composer: DecisionPort Choice among observe candidates,
 * then semantic / structural locators as fallback.
 * Returns the editable target or null.
 */
async function openComposer(
  page: Page,
  decide: DecisionPort
): Promise<ReturnType<Page["locator"]> | null> {
  // Prefer decide to expand "Add a comment" when the editor is not yet visible.
  try {
    const openDecided = await decideComposerControl(page, "open_composer", {
      decide,
    });
    console.log(
      `[comment] open_composer decide id=${openDecided.selectedId ?? "none"} ` +
        `conf=${openDecided.confidence.toFixed(2)} escalate=${openDecided.escalateHitl} ` +
        `backend=${openDecided.backend}`
    );
    const openId = openDecided.selectedId ?? "";
    if (openId && /chat|message|share|award/i.test(openId)) {
      console.warn(
        `[comment] open_composer decide ignored suspicious id=${openId}`
      );
    } else if (openDecided.selectedId) {
      await actComposerControl(page, openDecided, "click");
      await sleep(400);
    }
  } catch (err) {
    console.warn("[comment] open_composer decide failed:", err);
  }

  // Semantic expand fallback
  const addTriggers = [
    page.getByRole("button", { name: /Add a comment|Leave a comment/i }),
    page.getByText(/^Add a comment$/i),
    page.locator("shreddit-composer").getByRole("textbox"),
  ];
  for (const trigger of addTriggers) {
    try {
      if ((await trigger.count()) > 0 && (await trigger.first().isVisible())) {
        await trigger.first().click({ timeout: 3000 });
        await sleep(400);
        break;
      }
    } catch {
      /* try next */
    }
  }

  // Decide which control is the editor
  try {
    const editorDecided = await decideComposerControl(page, "editor", {
      decide,
    });
    console.log(
      `[comment] editor decide id=${editorDecided.selectedId ?? "none"} ` +
        `conf=${editorDecided.confidence.toFixed(2)} escalate=${editorDecided.escalateHitl}`
    );
    if (editorDecided.selectedId) {
      const loc = resolveComposerLocator(page, editorDecided);
      if (loc) {
        try {
          await loc.waitFor({ state: "visible", timeout: 5_000 });
          return loc;
        } catch {
          /* fall through */
        }
      }
    }
  } catch (err) {
    console.warn("[comment] editor decide failed:", err);
  }

  const candidates = [
    page.locator("shreddit-composer [contenteditable='true']"),
    page.locator("[contenteditable='true']"),
    page.getByRole("textbox", { name: /add a comment|comment/i }),
    page.locator("faceplate-textarea textarea, textarea"),
  ];

  for (const loc of candidates) {
    try {
      if ((await loc.count()) === 0) continue;
      const first = loc.first();
      await first.waitFor({ state: "visible", timeout: 8_000 });
      return first;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function readEditorText(
  editor: ReturnType<Page["locator"]>
): Promise<string> {
  const inner = (await editor.innerText().catch(() => "")).trim();
  if (inner) return inner;
  return (await editor.inputValue().catch(() => "")).trim();
}

async function fillComposer(
  page: Page,
  editor: ReturnType<Page["locator"]>,
  text: string
): Promise<void> {
  await editor.click({ timeout: 5_000 });
  // Clear any placeholder / leftover, then type — Reddit contenteditable
  // often ignores fill() and leaves the Comment button disabled.
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+A" : "Control+A"
  );
  await page.keyboard.press("Backspace");
  try {
    await editor.fill(text);
  } catch {
    /* type path below */
  }
  if (!(await readEditorText(editor))) {
    await page.keyboard.type(text, { delay: 8 });
  }
  // Trigger input listeners so Reddit enables Comment.
  await editor.dispatchEvent("input").catch(() => undefined);
  await sleep(300);

  const landed = await readEditorText(editor);
  if (!landed) {
    throw new Error(
      "Comment text did not land in the composer (Comment button would stay disabled)"
    );
  }
  if (landed.length < Math.min(12, text.trim().length)) {
    console.warn(
      `[comment] composer text looks short (${landed.length} chars) — retrying type`
    );
    await editor.click({ timeout: 3_000 });
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+A" : "Control+A"
    );
    await page.keyboard.type(text, { delay: 8 });
    await sleep(200);
  }
}

async function findEnabledSubmitButton(
  page: Page
): Promise<ReturnType<Page["locator"]> | null> {
  const buttons = [
    page.locator("shreddit-composer").getByRole("button", { name: /^Comment$/i }),
    page.locator("shreddit-composer").getByRole("button", { name: /Comment|Reply/i }),
    page.locator('shreddit-composer button[type="submit"]'),
    page.locator("shreddit-composer faceplate-button").filter({ hasText: /^Comment$/i }),
    page.getByRole("button", { name: /^Comment$/i }),
    page.getByRole("button", { name: /^Reply$/i }),
  ];
  for (const btn of buttons) {
    try {
      if ((await btn.count()) === 0) continue;
      const first = btn.first();
      await first.waitFor({ state: "visible", timeout: 2_000 }).catch(() => undefined);
      if (!(await first.isEnabled().catch(() => false))) continue;
      return first;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Click Comment/Reply. Caller must already have HITL Approve — decide only
 * identifies the button; it never grants write permission.
 */
async function submitComment(page: Page, decide: DecisionPort): Promise<void> {
  // Wait for Reddit to enable Comment after text lands (often 0.5–2s).
  for (let i = 0; i < 10; i++) {
    const ready = await findEnabledSubmitButton(page);
    if (ready) break;
    await sleep(250);
  }

  try {
    const decided = await decideComposerControl(page, "submit", { decide });
    console.log(
      `[comment] submit decide id=${decided.selectedId ?? "none"} ` +
        `conf=${decided.confidence.toFixed(2)} escalate=${decided.escalateHitl} ` +
        `(post-Approve actuation only)`
    );
    if (decided.selectedId) {
      const refOk = await actComposerControl(page, decided, "click");
      if (refOk) {
        await sleep(400);
        // If decide clicked a stale/disabled control, fall through to semantics.
        const stillOpen = await findEnabledSubmitButton(page);
        if (!stillOpen) return;
        console.warn(
          "[comment] submit decide click left Comment enabled — trying semantic submit"
        );
      }
    }
  } catch (err) {
    console.warn("[comment] submit decide failed:", err);
  }

  const semantic = await findEnabledSubmitButton(page);
  if (semantic) {
    await semantic.click({ timeout: 5_000 });
    return;
  }

  // Last resort: Reddit accepts Ctrl/Cmd+Enter in the composer.
  console.warn("[comment] no enabled Comment button — trying Ctrl/Cmd+Enter");
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Enter" : "Control+Enter"
  );
  await sleep(800);
  const afterShortcut = await findEnabledSubmitButton(page);
  if (!afterShortcut) return;

  throw new Error(
    "Could not find enabled Comment/Reply submit button (composer text may not have registered)"
  );
}

async function capturePermalink(
  page: Page,
  snippet: string
): Promise<string | undefined> {
  const needle = snippet.trim().slice(0, 48);
  await sleep(1500);

  // URL may jump to the new comment
  const url = page.url();
  if (/\/comment\//i.test(url)) return url.split("?")[0];

  if (needle.length >= 12) {
    try {
      const comment = page
        .locator("shreddit-comment, [id^='t1_'], .Comment")
        .filter({ hasText: needle })
        .first();
      if ((await comment.count()) > 0) {
        const link = comment.locator('a[href*="/comment/"]').first();
        if ((await link.count()) > 0) {
          const href = await link.getAttribute("href");
          if (href) {
            return href.startsWith("http")
              ? href.split("?")[0]
              : `https://www.reddit.com${href}`.split("?")[0];
          }
        }
        const id = await comment.getAttribute("id");
        if (id?.startsWith("t1_")) {
          const base = url.split("?")[0].replace(/\/$/, "");
          return `${base}/${id}/`;
        }
      }
    } catch {
      /* fall through */
    }
  }

  return undefined;
}

/**
 * Ensure a usable Reddit browser session (jar or interactive login).
 */
export async function ensureBrowserSession(
  cfg: CommunityRuntimeConfig,
  opts: { loginIfNeeded?: boolean; headless?: boolean } = {}
): Promise<{ ok: boolean; error?: string }> {
  const loginIfNeeded = opts.loginIfNeeded ?? cfg.reddit.hasUserPass;
  if (await hasStorageState(cfg.reddit)) {
    return { ok: true };
  }
  if (!loginIfNeeded) {
    return {
      ok: false,
      error:
        "No Reddit storageState jar — run `pnpm login:reddit` or set REDDIT_USERNAME/PASSWORD",
    };
  }
  if (!cfg.reddit.hasUserPass) {
    return {
      ok: false,
      error: "Missing cookie jar and REDDIT_USERNAME/PASSWORD for login fallback",
    };
  }
  console.log("[comment] no jar — running browser login…");
  const login = await loginRedditBrowser({
    cfg,
    headless: opts.headless,
  });
  if (!login.ok) {
    return { ok: false, error: login.error ?? "browser login failed" };
  }
  return { ok: true };
}

/**
 * Post a comment on a thread via Playwright.
 * Composer targets via DecisionPort + semantic fallback.
 * Requires prior Approve in the HITL flow; caller enforces dry-run —
 * decide never grants write permission.
 */
export async function postCommentBrowser(
  opts: BrowserCommentOptions
): Promise<BrowserCommentResult> {
  const cfg = opts.cfg ?? getCommunityConfig();
  const text = opts.text.trim();
  if (!text) {
    return { ok: false, error: "empty comment text" };
  }
  if (!opts.threadUrl) {
    return { ok: false, error: "missing threadUrl" };
  }

  const headedEnv =
    process.env.REDDIT_LOGIN_HEADED === "true" ||
    process.env.REDDIT_LOGIN_HEADED === "1";
  const headless =
    opts.headless ?? (headedEnv ? false : cfg.reddit.browserHeadless);
  const decide = opts.decide ?? createDecisionPort();

  const session = await ensureBrowserSession(cfg, {
    loginIfNeeded: opts.loginIfNeeded,
    headless,
  });
  if (!session.ok) {
    return { ok: false, error: session.error };
  }

  const { engine } = await createRedditBrowserEngine({
    cfg,
    useStoredSession: true,
    headless,
  });

  try {
    const page = await engine.getPage();
    console.log(
      `[comment] → ${opts.threadUrl} (decide=${decide.backendName})`
    );
    await page.goto(opts.threadUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await dismissCookieBanner(page);
    await sleep(1500);

    if (await isAuthWall(page)) {
      const retries = opts._authRetries ?? 1;
      if (retries <= 0) {
        return {
          ok: false,
          error: "Auth wall persists after login — session may be blocked",
          loggedIn: false,
        };
      }
      console.warn("[comment] auth wall — re-login…");
      await engine.teardown();
      const relogin = await loginRedditBrowser({ cfg, headless, decide });
      if (!relogin.ok) {
        return {
          ok: false,
          error: relogin.error ?? "re-login failed",
          loggedIn: false,
        };
      }
      return postCommentBrowser({
        ...opts,
        loginIfNeeded: false,
        cfg,
        headless,
        decide,
        _authRetries: retries - 1,
      });
    }

    const editor = await openComposer(page, decide);
    if (!editor) {
      return {
        ok: false,
        error:
          "Comment composer not found (decide + semantic locators failed). Try headed login or re-run login:reddit.",
        loggedIn: true,
      };
    }

    await fillComposer(page, editor, text);
    await submitComment(page, decide);

    const permalink = await capturePermalink(page, text);
    await saveSession(page, cfg.reddit);

    if (!permalink) {
      console.warn(
        "[comment] submitted but permalink not captured — treating as ok"
      );
    }

    return {
      ok: true,
      permalink: permalink ?? opts.threadUrl,
      loggedIn: true,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try {
      await engine.teardown();
    } catch {
      /* ignore */
    }
  }
}
