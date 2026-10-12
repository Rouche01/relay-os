/**
 * Parse HITL credential FeedbackResponse values.
 * Convention: `username\npassword` (optional third line OTP), or
 * `{ username, password, otp? }` / meta on FeedbackContext.
 */

export interface RedditCredentials {
  username: string;
  password: string;
  otp?: string;
}

export function parseCredentialValue(value: unknown): RedditCredentials | null {
  if (value == null || value === true || value === false) return null;

  if (typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const username = str(o.username ?? o.user ?? o.email);
    const password = str(o.password ?? o.pass);
    const otp = str(o.otp ?? o.code) || undefined;
    if (username && password) return { username, password, otp };
    return null;
  }

  if (typeof value !== "string") return null;
  const lines = value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  return {
    username: lines[0]!,
    password: lines[1]!,
    otp: lines[2] || undefined,
  };
}

export function isLoginCredentialPoint(description: string): boolean {
  return !isOtpCredentialPoint(description);
}

export function isOtpCredentialPoint(description: string): boolean {
  return /\b(otp|2fa|verification code|one-time)\b/i.test(description);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
