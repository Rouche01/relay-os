/**
 * Called when an allowlisted user sends text and no HITL present is pending.
 * Return a reply string to send back to the chat (ops intents, etc.).
 */
export type TelegramIdleMessageHandler = (
  text: string
) => Promise<string | void>;

/** Config for the Telegram HITL adapter. */
export interface TelegramAdapterConfig {
  botToken: string;
  /** Only this numeric Telegram user id may Approve / Edit / Abort. */
  allowlistUserId: number;
  /**
   * Chat to send draft cards to (usually a private chat with the allowlisted user).
   * Defaults to allowlistUserId.
   */
  chatId?: number;
  /** Long-poll timeout seconds for getUpdates (default 25). */
  pollTimeoutSec?: number;
  /**
   * When set, idle (no HITL pending) allowlisted messages are forwarded here
   * instead of being dropped. HITL always wins when a present is in flight.
   */
  onIdleMessage?: TelegramIdleMessageHandler;
  /**
   * Inject a client (tests). Defaults to a real {@link TelegramClient}.
   * @internal
   */
  client?: {
    sendMessage(params: {
      chat_id: number;
      text: string;
      parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
      reply_markup?: unknown;
      disable_web_page_preview?: boolean;
    }): Promise<{ message_id: number; chat: { id: number }; date: number }>;
    getUpdates(offset: number, timeoutSec: number): Promise<unknown[]>;
    answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
    editMessageReplyMarkup(
      chatId: number,
      messageId: number,
      replyMarkup?: unknown
    ): Promise<void>;
    setMyCommands?(
      commands: { command: string; description: string }[]
    ): Promise<void>;
  };
}

export type TelegramAdapterEnv = {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_ALLOWLIST_USER_ID?: string;
  TELEGRAM_CHAT_ID?: string;
};
