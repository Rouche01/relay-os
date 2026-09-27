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
}

export type TelegramAdapterEnv = {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_ALLOWLIST_USER_ID?: string;
  TELEGRAM_CHAT_ID?: string;
};
