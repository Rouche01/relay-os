import type { FeedbackAdapter } from "@relay/feedback-broker";
import type { FeedbackRequest, FeedbackResponse } from "@relay/protocol";
import { TelegramClient, type TelegramUpdate } from "./client.js";
import {
  approveAbortKeyboard,
  formatFeedbackMessage,
  parseCallbackData,
  parseEditCommand,
} from "./format.js";
import type { TelegramAdapterConfig, TelegramAdapterEnv } from "./types.js";

interface Pending {
  request: FeedbackRequest;
  chatId: number;
  messageId: number;
  resolve: (response: FeedbackResponse) => void;
  reject: (err: Error) => void;
}

/**
 * Telegram FeedbackAdapter — Approve / Abort inline buttons; reply `edit: …`.
 * Only TELEGRAM_ALLOWLIST_USER_ID may decide.
 *
 * Call `start()` before attaching the FeedbackBroker (begins long-poll).
 * Call `stop()` on shutdown.
 */
export class TelegramFeedbackAdapter implements FeedbackAdapter {
  readonly name = "telegram";

  private readonly client: TelegramClient;
  private readonly allowlistUserId: number;
  private readonly chatId: number;
  private readonly pollTimeoutSec: number;

  private pendingByRequestId = new Map<string, Pending>();
  private pendingByMessageId = new Map<number, Pending>();
  private offset = 0;
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(config: TelegramAdapterConfig) {
    if (!config.botToken) {
      throw new Error("TelegramFeedbackAdapter requires botToken");
    }
    if (!Number.isFinite(config.allowlistUserId)) {
      throw new Error("TelegramFeedbackAdapter requires allowlistUserId");
    }
    this.client = new TelegramClient(config.botToken);
    this.allowlistUserId = config.allowlistUserId;
    this.chatId = config.chatId ?? config.allowlistUserId;
    this.pollTimeoutSec = config.pollTimeoutSec ?? 25;
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
      reply_markup: approveAbortKeyboard(request.id),
    });

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

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.client.getUpdates(this.offset, this.pollTimeoutSec);
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
      value:
        parsed.action === "proceed"
          ? (pending.request.context?.body ?? true)
          : false,
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

    // Prefer reply-to matching our card; else single pending fallback.
    let pending: Pending | undefined;
    if (msg.reply_to_message) {
      pending = this.pendingByMessageId.get(msg.reply_to_message.message_id);
    }
    if (!pending && this.pendingByRequestId.size === 1) {
      pending = [...this.pendingByRequestId.values()][0];
    }
    if (!pending) return;

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

    const lower = text.toLowerCase();
    if (["approve", "a", "yes", "y"].includes(lower)) {
      const response: FeedbackResponse = {
        requestId: pending.request.id,
        agentId: pending.request.agentId,
        action: "proceed",
        value: pending.request.context?.body ?? true,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
