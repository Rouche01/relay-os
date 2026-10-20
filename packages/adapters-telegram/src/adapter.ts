import type { FeedbackAdapter } from "@relay/feedback-broker";
import type { FeedbackRequest, FeedbackResponse } from "@relay/protocol";
import { TelegramClient, type TelegramUpdate } from "./client.js";
import {
  formatFeedbackMessage,
  isNotifyOnlyDraft,
  parseCallbackData,
  parseEditCommand,
  replyMarkupForFeedback,
} from "./format.js";
import type {
  TelegramAdapterConfig,
  TelegramAdapterEnv,
  TelegramIdleMessageHandler,
} from "./types.js";

interface Pending {
  request: FeedbackRequest;
  chatId: number;
  messageId: number;
  resolve: (response: FeedbackResponse) => void;
  reject: (err: Error) => void;
}

/** Telegram Bot API hard limit for message text. */
const TELEGRAM_MAX_TEXT = 4096;

type TelegramClientLike = NonNullable<TelegramAdapterConfig["client"]>;

/**
 * Telegram FeedbackAdapter — Approve / Abort inline buttons; reply `edit: …`.
 * Notify-only drafts (`postMode=manual`): no buttons; auto-proceed after send.
 * Only TELEGRAM_ALLOWLIST_USER_ID may decide.
 *
 * Optional `onIdleMessage` / {@link TelegramFeedbackAdapter.setOnIdleMessage}:
 * when no HITL present is in flight, allowlisted text is forwarded (ops intents).
 * HITL always wins when a present is pending.
 *
 * Call `start()` before attaching the FeedbackBroker (begins long-poll).
 * Call `stop()` on shutdown.
 */
export class TelegramFeedbackAdapter implements FeedbackAdapter {
  readonly name = "telegram";

  private readonly client: TelegramClientLike;
  private readonly allowlistUserId: number;
  private readonly chatId: number;
  private readonly pollTimeoutSec: number;
  private onIdleMessage: TelegramIdleMessageHandler | undefined;

  private pendingByRequestId = new Map<string, Pending>();
  private pendingByMessageId = new Map<number, Pending>();
  private offset = 0;
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(config: TelegramAdapterConfig) {
    if (!config.botToken && !config.client) {
      throw new Error("TelegramFeedbackAdapter requires botToken");
    }
    if (!Number.isFinite(config.allowlistUserId)) {
      throw new Error("TelegramFeedbackAdapter requires allowlistUserId");
    }
    this.client =
      config.client ?? new TelegramClient(config.botToken);
    this.allowlistUserId = config.allowlistUserId;
    this.chatId = config.chatId ?? config.allowlistUserId;
    this.pollTimeoutSec = config.pollTimeoutSec ?? 25;
    this.onIdleMessage = config.onIdleMessage;
  }

  /**
   * Attach or replace the idle-message handler (ops bridge).
   * Safe to call after construction / before or after {@link start}.
   */
  setOnIdleMessage(handler: TelegramIdleMessageHandler | undefined): void {
    this.onIdleMessage = handler;
  }

  /**
   * Register the bot `/` command menu via Bot API setMyCommands.
   * No-op when the injected client lacks setMyCommands (tests).
   */
  async setMyCommands(
    commands: { command: string; description: string }[]
  ): Promise<void> {
    if (!this.client.setMyCommands) {
      return;
    }
    await this.client.setMyCommands(commands);
  }

  /** Begin long-polling getUpdates. Safe to call once. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.pollLoop();
  }

  /** Stop polling and reject any outstanding presents. */
  async stop(): Promise<void> {
    this.running = false;
    for (const pending of this.pendingByRequestId.values()) {
      pending.reject(new Error("Telegram adapter stopped"));
    }
    this.pendingByRequestId.clear();
    this.pendingByMessageId.clear();
    if (this.loopPromise) {
      await this.loopPromise.catch(() => undefined);
      this.loopPromise = null;
    }
  }

  async present(request: FeedbackRequest): Promise<FeedbackResponse> {
    if (!this.running) {
      this.start();
    }

    const text = formatFeedbackMessage(request);
    const message = await this.client.sendMessage({
      chat_id: this.chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: replyMarkupForFeedback(request),
    });

    // Notify-only: card is the copy-paste notify — no Approve wait.
    if (isNotifyOnlyDraft(request)) {
      return {
        requestId: request.id,
        agentId: request.agentId,
        action: "proceed",
        value: true,
      };
    }

    return new Promise<FeedbackResponse>((resolve, reject) => {
      const pending: Pending = {
        request,
        chatId: message.chat.id,
        messageId: message.message_id,
        resolve,
        reject,
      };
      this.pendingByRequestId.set(request.id, pending);
      this.pendingByMessageId.set(message.message_id, pending);
    });
  }

  /**
   * Settle an in-flight present early (browser auto-detected clear, etc.).
   */
  cancelPresent(requestId: string, response: FeedbackResponse): void {
    const pending = this.pendingByRequestId.get(requestId);
    if (!pending) return;
    void this.clearKeyboard(pending).finally(() => {
      this.settle(pending, response);
    });
    void this.client
      .sendMessage({
        chat_id: this.chatId,
        text: "✅ Auto-detected: challenge cleared in the browser — continuing.",
        disable_web_page_preview: true,
      })
      .catch(() => undefined);
  }

  /** One-way Telegram notice (CAPTCHA during login, etc.). */
  async notify(message: string): Promise<void> {
    await this.client.sendMessage({
      chat_id: this.chatId,
      text: message,
      disable_web_page_preview: true,
    });
  }

  /** True when at least one HITL present is awaiting a reply. */
  hasPendingHitl(): boolean {
    return this.pendingByRequestId.size > 0;
  }

  /**
   * Simulate an allowlisted text message (unit tests / local harness).
   * Does not run the poll loop.
   */
  async ingestAllowlistedText(
    text: string,
    opts?: { replyToMessageId?: number }
  ): Promise<void> {
    const replyTo =
      opts?.replyToMessageId != null
        ? {
            message_id: opts.replyToMessageId,
            date: 0,
            chat: { id: this.chatId, type: "private" },
          }
        : undefined;
    await this.handleMessage({
      update_id: 0,
      message: {
        message_id: Date.now() % 1_000_000,
        date: Math.floor(Date.now() / 1000),
        chat: { id: this.chatId, type: "private" },
        from: { id: this.allowlistUserId, first_name: "ops" },
        text,
        ...(replyTo ? { reply_to_message: replyTo } : {}),
      },
    });
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = (await this.client.getUpdates(
          this.offset,
          this.pollTimeoutSec
        )) as TelegramUpdate[];
        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      } catch (err) {
        if (!this.running) break;
        console.error("[telegram-adapter] poll error:", err);
        await sleep(2000);
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallback(update);
      return;
    }
    if (update.message?.text) {
      await this.handleMessage(update);
    }
  }

  private async handleCallback(update: TelegramUpdate): Promise<void> {
    const cq = update.callback_query!;
    if (cq.from.id !== this.allowlistUserId) {
      await this.client.answerCallbackQuery(cq.id, "Not authorized");
      return;
    }
    if (!cq.data) return;

    const parsed = parseCallbackData(cq.data);
    if (!parsed) {
      await this.client.answerCallbackQuery(cq.id);
      return;
    }

    const pending = this.pendingByRequestId.get(parsed.requestId);
    if (!pending) {
      await this.client.answerCallbackQuery(cq.id, "Already handled or expired");
      return;
    }

    const response: FeedbackResponse = {
      requestId: pending.request.id,
      agentId: pending.request.agentId,
      action: parsed.action,
      value: parsed.action === "proceed" ? true : false,
    };

    await this.client.answerCallbackQuery(
      cq.id,
      parsed.action === "proceed" ? "Approved" : "Aborted"
    );
    await this.clearKeyboard(pending);
    this.settle(pending, response);
  }

  private async handleMessage(update: TelegramUpdate): Promise<void> {
    const msg = update.message!;
    if (!msg.from || msg.from.id !== this.allowlistUserId) {
      return;
    }
    const text = msg.text!.trim();
    if (!text) return;

    // Prefer reply-to matching our card; else single pending fallback.
    let pending: Pending | undefined;
    if (msg.reply_to_message) {
      pending = this.pendingByMessageId.get(msg.reply_to_message.message_id);
    }
    if (!pending && this.pendingByRequestId.size === 1) {
      pending = [...this.pendingByRequestId.values()][0];
    }

    // HITL in flight but unmatched (e.g. multiple cards, no reply-to): do not
    // steal for ops — operator must reply to the card / use buttons.
    if (!pending && this.pendingByRequestId.size > 0) {
      return;
    }

    if (!pending) {
      // Fire-and-forget: idle ops (e.g. engage) can await HITL present().
      // Awaiting here deadlocks the poll loop — Approve callbacks never run.
      this.dispatchIdle(text);
      return;
    }

    const edited = parseEditCommand(text);
    if (edited !== null) {
      const response: FeedbackResponse = {
        requestId: pending.request.id,
        agentId: pending.request.agentId,
        action: "proceed",
        value: edited,
      };
      await this.clearKeyboard(pending);
      this.settle(pending, response);
      return;
    }

    // Credential / freeform: accept raw reply as the value (do not require edit:)
    if (
      pending.request.type === "credential" ||
      pending.request.type === "freeform" ||
      pending.request.type === "choice"
    ) {
      const lower = text.toLowerCase();
      if (["abort", "x", "no", "n"].includes(lower)) {
        const response: FeedbackResponse = {
          requestId: pending.request.id,
          agentId: pending.request.agentId,
          action: "abort",
          value: false,
        };
        await this.clearKeyboard(pending);
        this.settle(pending, response);
        return;
      }
      const response: FeedbackResponse = {
        requestId: pending.request.id,
        agentId: pending.request.agentId,
        action: "proceed",
        value: text,
      };
      await this.clearKeyboard(pending);
      this.settle(pending, response);
      return;
    }

    const lower = text.toLowerCase();
    if (["approve", "a", "yes", "y"].includes(lower)) {
      const response: FeedbackResponse = {
        requestId: pending.request.id,
        agentId: pending.request.agentId,
        action: "proceed",
        value: true,
      };
      await this.clearKeyboard(pending);
      this.settle(pending, response);
      return;
    }
    if (["abort", "x", "no", "n"].includes(lower)) {
      const response: FeedbackResponse = {
        requestId: pending.request.id,
        agentId: pending.request.agentId,
        action: "abort",
        value: false,
      };
      await this.clearKeyboard(pending);
      this.settle(pending, response);
    }
  }

  /**
   * Kick off idle ops without blocking the caller (poll loop).
   * Long handlers that call {@link present} must not hold getUpdates.
   */
  private dispatchIdle(text: string): void {
    if (!this.onIdleMessage) return;
    void this.runIdleMessage(text);
  }

  private async runIdleMessage(text: string): Promise<void> {
    if (!this.onIdleMessage) return;
    try {
      const reply = await this.onIdleMessage(text);
      if (reply == null || reply === "") return;
      await this.client.sendMessage({
        chat_id: this.chatId,
        text: truncateTelegramText(reply),
        disable_web_page_preview: true,
      });
    } catch (err) {
      console.error("[telegram-adapter] idle message handler failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      try {
        await this.client.sendMessage({
          chat_id: this.chatId,
          text: truncateTelegramText(`Ops error: ${message}`),
          disable_web_page_preview: true,
        });
      } catch {
        // ignore secondary send failure
      }
    }
  }

  private settle(pending: Pending, response: FeedbackResponse): void {
    this.pendingByRequestId.delete(pending.request.id);
    this.pendingByMessageId.delete(pending.messageId);
    pending.resolve(response);
  }

  private async clearKeyboard(pending: Pending): Promise<void> {
    try {
      await this.client.editMessageReplyMarkup(pending.chatId, pending.messageId);
    } catch {
      // Message may be too old / already cleared — ignore.
    }
  }
}

export function createTelegramAdapterFromEnv(
  env: TelegramAdapterEnv & NodeJS.ProcessEnv = process.env
): TelegramFeedbackAdapter {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const allowlistRaw = env.TELEGRAM_ALLOWLIST_USER_ID;
  if (!botToken) {
    throw new Error("Set TELEGRAM_BOT_TOKEN (from BotFather)");
  }
  if (!allowlistRaw) {
    throw new Error("Set TELEGRAM_ALLOWLIST_USER_ID to your numeric Telegram user id");
  }
  const allowlistUserId = Number(allowlistRaw);
  if (!Number.isFinite(allowlistUserId)) {
    throw new Error("TELEGRAM_ALLOWLIST_USER_ID must be a number");
  }
  const chatId = env.TELEGRAM_CHAT_ID ? Number(env.TELEGRAM_CHAT_ID) : undefined;

  return new TelegramFeedbackAdapter({
    botToken,
    allowlistUserId,
    chatId,
  });
}

export function truncateTelegramText(
  text: string,
  max = TELEGRAM_MAX_TEXT
): string {
  if (text.length <= max) return text;
  const suffix = "\n…(truncated)";
  return text.slice(0, Math.max(0, max - suffix.length)) + suffix;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
