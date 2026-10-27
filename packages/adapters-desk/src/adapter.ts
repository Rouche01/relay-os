import http from "node:http";
import type { FeedbackAdapter } from "@relay/feedback-broker";
import type {
  FeedbackAction,
  FeedbackRequest,
  FeedbackResponse,
} from "@relay/protocol";
import type { DeskAdapterConfig, DeskAdapterEnv } from "./types.js";

interface Pending {
  request: FeedbackRequest;
  presentedAt: string;
  resolve: (response: FeedbackResponse) => void;
  reject: (err: Error) => void;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function cors(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type"
  );
}

function json(
  res: http.ServerResponse,
  status: number,
  body: unknown
): void {
  cors(res);
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

/**
 * Desk FeedbackAdapter — HTTP bridge for Relay Desk (Tauri).
 *
 * CE process owns the adapter; Desk polls `GET /v1/pending` and
 * responds via `POST /v1/respond`.
 *
 * Call {@link start} before attaching FeedbackBroker; {@link stop} on shutdown.
 */
export class DeskFeedbackAdapter implements FeedbackAdapter {
  readonly name = "desk";

  private readonly host: string;
  private readonly port: number;
  private readonly token: string | undefined;
  private readonly pending = new Map<string, Pending>();
  private server: http.Server | null = null;
  private notices: { at: string; message: string }[] = [];

  constructor(config: DeskAdapterConfig = {}) {
    this.host = (config.host ?? "127.0.0.1").trim() || "127.0.0.1";
    const port = Number(config.port ?? 9100);
    this.port = Number.isFinite(port) && port > 0 ? Math.floor(port) : 9100;
    const token = config.token?.trim();
    this.token = token || undefined;
  }

  /** Base URL Desk should use (http://host:port). */
  get listenUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  start(): void {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
    this.server.listen(this.port, this.host);
  }

  async stop(): Promise<void> {
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      p.reject(new Error("desk adapter stopped"));
    }
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  async present(request: FeedbackRequest): Promise<FeedbackResponse> {
    if (this.pending.has(request.id)) {
      throw new Error(`desk: duplicate present for ${request.id}`);
    }
    return new Promise<FeedbackResponse>((resolve, reject) => {
      this.pending.set(request.id, {
        request,
        presentedAt: new Date().toISOString(),
        resolve,
        reject,
      });
    });
  }

  cancelPresent(requestId: string, response: FeedbackResponse): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    pending.resolve(response);
  }

  async notify(message: string): Promise<void> {
    this.notices.push({
      at: new Date().toISOString(),
      message,
    });
    if (this.notices.length > 20) {
      this.notices = this.notices.slice(-20);
    }
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  private authorized(req: http.IncomingMessage): boolean {
    if (!this.token) return true;
    const header = req.headers.authorization ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(header);
    return Boolean(m?.[1] && m[1] === this.token);
  }

  private async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      if (req.method === "OPTIONS") {
        cors(res);
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", `http://${this.host}`);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (path === "/health" && req.method === "GET") {
        json(res, 200, {
          ok: true,
          adapter: this.name,
          pending: this.pending.size,
        });
        return;
      }

      if (!this.authorized(req)) {
        json(res, 401, { error: "unauthorized" });
        return;
      }

      if (path === "/v1/pending" && req.method === "GET") {
        const items = [...this.pending.values()].map((p) => ({
          ...p.request,
          presentedAt: p.presentedAt,
        }));
        json(res, 200, {
          pending: items,
          notices: this.notices.slice(-5),
        });
        return;
      }

      if (path === "/v1/notices" && req.method === "GET") {
        json(res, 200, { notices: this.notices });
        return;
      }

      if (path === "/v1/respond" && req.method === "POST") {
        const raw = await readBody(req);
        let body: {
          requestId?: string;
          action?: string;
          value?: unknown;
        };
        try {
          body = JSON.parse(raw || "{}") as typeof body;
        } catch {
          json(res, 400, { error: "invalid json" });
          return;
        }
        const requestId = String(body.requestId ?? "").trim();
        const action = String(body.action ?? "").trim() as FeedbackAction;
        if (!requestId) {
          json(res, 400, { error: "requestId required" });
          return;
        }
        if (action !== "proceed" && action !== "abort" && action !== "retry") {
          json(res, 400, {
            error: "action must be proceed | abort | retry",
          });
          return;
        }
        const pending = this.pending.get(requestId);
        if (!pending) {
          json(res, 404, { error: "not pending" });
          return;
        }
        this.pending.delete(requestId);
        const response: FeedbackResponse = {
          requestId,
          agentId: pending.request.agentId,
          action,
          value: body.value,
        };
        pending.resolve(response);
        json(res, 200, { ok: true, response });
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (err) {
      json(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function createDeskAdapterFromEnv(
  env: DeskAdapterEnv = process.env
): DeskFeedbackAdapter {
  const portRaw = env.DESK_HITL_PORT?.trim();
  const port = portRaw ? Number(portRaw) : 9100;
  return new DeskFeedbackAdapter({
    host: env.DESK_HITL_HOST?.trim() || "127.0.0.1",
    port: Number.isFinite(port) ? port : 9100,
    token: env.DESK_HITL_TOKEN?.trim() || undefined,
  });
}
