import { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { ExecutionEngine, EngineResult } from "@relay/protocol";
import { BrowserEngineAction, SemanticLocator } from "./types";

chromium.use(stealthPlugin());

export class PlaywrightEngine implements ExecutionEngine {
  public type = "browser" as const;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private headless: boolean;
  private userAgent?: string;

  constructor(options: { headless?: boolean; userAgent?: string } = {}) {
    this.headless = options.headless ?? true;
    this.userAgent = options.userAgent;
  }

  /** Expose the active page after launch (for structured page.evaluate extracts). */
  async getPage(): Promise<Page> {
    await this.ensureBrowser();
    return this.page!;
  }

  /** Run a browser-context function (must be self-contained / serializable). */
  async evaluate<T>(fn: () => T | Promise<T>): Promise<T> {
    const page = await this.getPage();
    return page.evaluate(fn);
  }

  async execute(action: BrowserEngineAction): Promise<EngineResult> {
    try {
      await this.ensureBrowser();
      const page = this.page!;

      switch (action.type) {
        case "navigate": {
          if (!action.params.url) throw new Error("URL is required for navigate action.");
          await page.goto(action.params.url, { waitUntil: "domcontentloaded" });
          return { success: true, data: { url: page.url() } };
        }
        
        case "click": {
          if (!action.params.target) throw new Error("Target is required for click action.");
          const locator = this.resolveLocator(page, action.params.target);
          await locator.click();
          return { success: true };
        }

        case "input": {
          if (!action.params.target) throw new Error("Target is required for input action.");
          if (action.params.value === undefined) throw new Error("Value is required for input action.");
          const locator = this.resolveLocator(page, action.params.target);
          await locator.fill(action.params.value);
          return { success: true };
        }

        case "extract": {
          if (!action.params?.target) throw new Error("Target is required for extract action.");
          const locator = this.resolveLocator(page, action.params.target);
          const text = await locator.textContent();
          return { success: true, data: { text: text?.trim() || "" } };
        }

        case "snapshot": {
          const title = await page.title();
          const url = page.url();
          // To keep it simple for now, we return the innerText and the HTML.
          // Gemini 2.5 has a massive context window so it can handle the raw HTML,
          // but we will also provide innerText for quick context.
          const text = await page.evaluate(() => document.body.innerText);
          const html = await page.content();
          return { success: true, data: { title, url, text, html } };
        }

        default:
          throw new Error(`Unsupported browser action type: ${(action as any).type}`);
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private resolveLocator(page: Page, target: SemanticLocator) {
    if ("role" in target) {
      return page.getByRole(target.role as any, { name: target.name });
    }
    if ("text" in target) {
      return page.getByText(target.text);
    }
    if ("placeholder" in target) {
      return page.getByPlaceholder(target.placeholder);
    }
    throw new Error("Invalid semantic locator format.");
  }

  private async ensureBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: this.headless });
      this.context = await this.browser.newContext(
        this.userAgent ? { userAgent: this.userAgent } : undefined
      );
      this.page = await this.context.newPage();
    }
  }

  async healthCheck(): Promise<boolean> {
    return true; // Simple health check
  }

  async teardown(): Promise<void> {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}
