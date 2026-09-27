/**
 * Minimal Telegram Bot API client (HTTP + long poll).
 * No Telegraf/Grammy — keeps Relay adapters thin.
 */

const API = "https://api.telegram.org";

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  reply_to_message?: TelegramMessage;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface SendMessageParams {
  chat_id: number;
  text: string;
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
  reply_markup?: unknown;
  disable_web_page_preview?: boolean;
}

export class TelegramClient {
  constructor(private readonly botToken: string) {}

  async sendMessage(params: SendMessageParams): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("sendMessage", params as unknown as Record<string, unknown>);
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
    });
  }

  async editMessageReplyMarkup(
    chatId: number,
    messageId: number,
    replyMarkup: unknown = { inline_keyboard: [] }
  ): Promise<void> {
    await this.call("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup,
    });
  }

  async getUpdates(offset: number, timeoutSec: number): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>("getUpdates", {
      offset,
      timeout: timeoutSec,
      allowed_updates: ["message", "callback_query"],
    });
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const url = `${API}/bot${this.botToken}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as { ok: boolean; description?: string; result?: T };
    if (!data.ok) {
      throw new Error(`Telegram API ${method} failed: ${data.description ?? res.statusText}`);
    }
    return data.result as T;
  }
}
