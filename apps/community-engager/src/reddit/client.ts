import type { RedditEnvConfig } from "./config.js";

export interface RedditListingPost {
  id: string;
  name: string; // t3_xxx
  subreddit: string;
  title: string;
  selftext: string;
  url: string;
  permalink: string;
  createdUtc: number;
  author: string;
}

/**
 * Minimal Reddit OAuth client (script app password grant).
 * Read: listing new posts. Write: comment (only when dryRun is false).
 */
export class RedditClient {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly cfg: RedditEnvConfig) {
    if (!cfg.oauthConfigured && !cfg.configured) {
      throw new Error("Reddit OAuth credentials not configured (REDDIT_CLIENT_*)");
    }
  }

  async listNew(subreddit: string, limit = 25): Promise<RedditListingPost[]> {
    const token = await this.getToken();
    const url = `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/new?limit=${limit}&raw_json=1`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": this.cfg.userAgent,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Reddit listNew r/${subreddit} failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as {
      data?: { children?: Array<{ data: Record<string, unknown> }> };
    };
    const children = data.data?.children ?? [];
    return children.map((c) => {
      const d = c.data;
      const permalink = String(d.permalink ?? "");
      return {
        id: String(d.id),
        name: String(d.name),
        subreddit: String(d.subreddit),
        title: String(d.title ?? ""),
        selftext: String(d.selftext ?? ""),
        url: String(d.url ?? ""),
        permalink: permalink.startsWith("http")
          ? permalink
          : `https://reddit.com${permalink}`,
        createdUtc: Number(d.created_utc ?? 0),
        author: String(d.author ?? ""),
      };
    });
  }

  /**
   * Post a comment on a link/comment thing.
   * Returns the new comment fullname when successful.
   */
  async postComment(thingId: string, text: string): Promise<{ id: string; permalink?: string }> {
    if (this.cfg.dryRun) {
      throw new Error("RedditClient.postComment refused: REDDIT_DRY_RUN is enabled");
    }
    const token = await this.getToken();
    const body = new URLSearchParams({
      api_type: "json",
      thing_id: thingId,
      text,
    });
    const res = await fetch("https://oauth.reddit.com/api/comment", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": this.cfg.userAgent,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const json = (await res.json()) as {
      json?: {
        errors?: unknown[];
        data?: { things?: Array<{ data?: { id?: string; permalink?: string } }> };
      };
    };
    if (!res.ok || (json.json?.errors && json.json.errors.length > 0)) {
      throw new Error(
        `Reddit comment failed: ${res.status} ${JSON.stringify(json.json?.errors ?? json)}`
      );
    }
    const thing = json.json?.data?.things?.[0]?.data;
    return {
      id: thing?.id ?? thingId,
      permalink: thing?.permalink
        ? thing.permalink.startsWith("http")
          ? thing.permalink
          : `https://reddit.com${thing.permalink}`
        : undefined,
    };
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAt - 30_000) {
      return this.accessToken;
    }

    const basic = Buffer.from(
      `${this.cfg.clientId}:${this.cfg.clientSecret}`
    ).toString("base64");
    const body = new URLSearchParams({
      grant_type: "password",
      username: this.cfg.username!,
      password: this.cfg.password!,
    });
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "User-Agent": this.cfg.userAgent,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`Reddit OAuth failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.accessToken = data.access_token;
    this.tokenExpiresAt = now + data.expires_in * 1000;
    return this.accessToken;
  }
}
