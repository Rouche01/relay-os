import {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
} from "playwright";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { ExecutionEngine, EngineResult } from "@relay/protocol";
import {
  compactPageText,
  observePage,
  observeRefToSemantic,
  type ObserveLocatorRef,
  type ObservePageOptions,
  type ObservePageResult,
} from "./observe";
import { BrowserEngineAction, SemanticLocator } from "./types";

chromium.use(stealthPlugin());

export interface PlaywrightEngineOptions {
  headless?: boolean;
  userAgent?: string;
  /**
   * Playwright storageState — file path or in-memory object.
   * Used when creating the browser context (AUTHED session restore).
   */
  storageState?: BrowserContextOptions["storageState"];
}

export class PlaywrightEngine implements ExecutionEngine {
  public type = "browser" as const;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private headless: boolean;
  private userAgent?: string;
  private storageState?: BrowserContextOptions["storageState"];

  constructor(options: PlaywrightEngineOptions = {}) {
    this.headless = options.headless ?? true;
    this.userAgent = options.userAgent;
    this.storageState = options.storageState;
  }

  /** Expose the active page after launch (for structured page.evaluate extracts). */
  async getPage(): Promise<Page> {
    await this.ensureBrowser();
    return this.page!;
  }

  async getContext(): Promise<BrowserContext> {
    await this.ensureBrowser();
    return this.context!;
  }

  /** Run a browser-context function (must be self-contained / serializable). */
  async evaluate<T>(fn: () => T | Promise<T>): Promise<T> {
    const page = await this.getPage();
    return page.evaluate(fn);
  }

  /**
   * Observe interactive candidates + compact page text for DecisionPort.
   * Returns id→locator map owned by Relay — do not send locators to Jev.
   */
  async observeCandidates(
    options?: ObservePageOptions
  ): Promise<ObservePageResult> {
    const page = await this.getPage();
    return observePage(page, options);
  }

  /** Compact visible body text (whitespace collapsed, length capped). */
  async compactPageText(maxChars?: number): Promise<string> {
    const page = await this.getPage();
    const raw = await page.evaluate(() => document.body?.innerText ?? "");
    return compactPageText(raw, maxChars);
  }

  /**
   * Resolve an observe candidate id using a prior observe's locatorById map.
   * Throws if the id is unknown.
   */
  resolveObserveId(
    page: Page,
    id: string,
    locatorById: Record<string, ObserveLocatorRef>
  ) {
    const ref = locatorById[id];
    if (!ref) {
      throw new Error(`Unknown observe candidate id: ${id}`);
    }
    return this.resolveLocator(page, observeRefToSemantic(ref));
  }

  /** Persist current context to a Playwright storageState file. */
  async saveStorageState(filePath: string): Promise<void> {
    const context = await this.getContext();
    await context.storageState({ path: filePath });
  }

  async execute(action: BrowserEngineAction): Promise<EngineResult> {
    try {
      await this.ensureBrowser();
      const page = this.page!;

      switch (action.type) {
        case "navigate": {
          if (!action.params.url)
            throw new Error("URL is required for navigate action.");
          await page.goto(action.params.url, { waitUntil: "domcontentloaded" });
          return { success: true, data: { url: page.url() } };
        }

        case "click": {
          if (!action.params.target)
            throw new Error("Target is required for click action.");
          const locator = this.resolveLocator(page, action.params.target);
          await locator.click();
          return { success: true };
        }

        case "input": {
          if (!action.params.target)
            throw new Error("Target is required for input action.");
          if (action.params.value === undefined)
            throw new Error("Value is required for input action.");
          const locator = this.resolveLocator(page, action.params.target);
          await locator.fill(action.params.value);
          return { success: true };
        }

        case "extract": {
          if (!action.params?.target)
            throw new Error("Target is required for extract action.");
          const locator = this.resolveLocator(page, action.params.target);
          const text = await locator.textContent();
          return { success: true, data: { text: text?.trim() || "" } };
        }

        case "snapshot": {
          const title = await page.title();
          const url = page.url();
          const text = await page.evaluate(() => document.body.innerText);
          const html = await page.content();
          return { success: true, data: { title, url, text, html } };
        }

        default:
          throw new Error(
            `Unsupported browser action type: ${(action as any).type}`
          );
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private resolveLocator(page: Page, target: SemanticLocator) {
    if ("css" in target && target.css) {
      return page.locator(target.css);
    }
    if ("role" in target && target.role) {
      return page.getByRole(target.role as any, { name: target.name });
    }
    if ("text" in target && target.text) {
      return page.getByText(target.text);
    }
    if ("placeholder" in target && target.placeholder) {
      return page.getByPlaceholder(target.placeholder);
    }
    throw new Error("Invalid semantic locator format.");
  }

  private async ensureBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: this.headless });
      const contextOpts: BrowserContextOptions = {};
      if (this.userAgent) contextOpts.userAgent = this.userAgent;
      if (this.storageState) contextOpts.storageState = this.storageState;
      this.context = await this.browser.newContext(contextOpts);
      this.page = await this.context.newPage();
    }
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async teardown(): Promise<void> {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}
