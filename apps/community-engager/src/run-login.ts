/**
 * One-shot Reddit browser login → cookie jar under REDDIT_COOKIE_DIR.
 *
 * Usage:
 *   REDDIT_USERNAME=… REDDIT_PASSWORD=… pnpm login:reddit
 *   REDDIT_LOGIN_HEADED=true pnpm login:reddit   # recommended for 2FA
 */
import "dotenv/config";
import { getRedditEnv } from "./reddit/config.js";
import { loginRedditBrowser } from "./reddit/browser-login.js";

async function main(): Promise<void> {
  const cfg = getRedditEnv();
  console.log("=== Relay · Reddit browser login ===\n");
  console.log(`cookieDir: ${cfg.cookieDir}`);
  console.log(`account:   ${cfg.username ?? "(missing)"}`);
  console.log(
    `headed:    ${
      process.env.REDDIT_LOGIN_HEADED === "true" ||
      process.env.REDDIT_LOGIN_HEADED === "1" ||
      cfg.browserHeadless === false
    }\n`
  );

  const result = await loginRedditBrowser({
    cfg,
    headless:
      process.env.REDDIT_LOGIN_HEADED === "true" ||
      process.env.REDDIT_LOGIN_HEADED === "1"
        ? false
        : undefined,
  });

  if (!result.ok) {
    console.error(`[login] FAILED: ${result.error}`);
    if (result.url) console.error(`[login] url=${result.url}`);
    process.exit(1);
  }

  console.log(`[login] OK storageState=${result.storagePath}`);
  if (result.challenged) {
    console.log("[login] completed after challenge / human step");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
