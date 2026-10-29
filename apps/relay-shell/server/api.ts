/**
 * Spec governance API — app-agnostic (Relay shell).
 * Not CommunityEngager-bound. Default create: decide primitives → compose.
 *
 *   pnpm --filter @relay/apps-relay-shell api
 *   RELAY_SHELL_SERVE_UI=1 pnpm --filter @relay/apps-relay-shell api   # also serve dist/
 *
 * Env: copy `.env.example` → `.env` in this package (loaded below).
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  createSpecBundle,
  freezeSpec,
  markSpecAborted,
  markSpecRunning,
} from "@relay/protocol";
import { createFileSpecStore } from "@relay/spec-store";
import {
  composeAndBundleSpec,
  type ComposeSpecBody,
} from "./compose-spec.js";
import {
  handleEvals,
  handleFreeze,
  handleLower,
  handleRun,
  handleScaffold,
  handleValidate,
} from "./spec-v2.js";

const shellRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: join(shellRoot, ".env") });

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function dataDir(): string {
  return resolve(
    process.cwd(),
    process.env.RELAY_DATA_DIR?.trim() || ".data"
  );
}

function distDir(): string | null {
  const override = process.env.RELAY_SHELL_DIST?.trim();
  const dir = override
    ? resolve(override)
    : join(shellRoot, "dist");
  if (!existsSync(join(dir, "index.html"))) return null;
  return dir;
}

function contentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json";
    case ".ico":
      return "image/x-icon";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function tryServeStatic(
  res: ServerResponse,
  dist: string,
  pathname: string
): boolean {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(dist, safe === "/" ? "index.html" : safe);
  if (!filePath.startsWith(dist)) return false;

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(dist, "index.html");
  }
  if (!existsSync(filePath)) return false;

  res.writeHead(200, {
    "content-type": contentType(filePath),
    "cache-control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=3600",
  });
  createReadStream(filePath).pipe(res);
  return true;
}

async function main(): Promise<void> {
  const store = createFileSpecStore(dataDir());
  const host = process.env.SPEC_UI_HOST ?? "127.0.0.1";
  const port = Number(process.env.SPEC_UI_PORT ?? "8790");
  const serveUi =
    process.env.RELAY_SHELL_SERVE_UI === "1" ||
    process.env.RELAY_SHELL_SERVE_UI === "true";
  const dist = serveUi ? distDir() : null;

  const server = createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        });
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      const method = req.method ?? "GET";

      if (method === "GET" && url.pathname === "/api/health") {
        const forceStub =
          process.env.RELAY_SPEC_SCAFFOLD_STUB === "1" ||
          process.env.RELAY_SPEC_SCAFFOLD_STUB === "true";
        const llmProvider = (
          process.env.LLM_PROVIDER || "gemini"
        )
          .trim()
          .toLowerCase();
        sendJson(res, 200, {
          ok: true,
          store: store.path,
          ui: dist ? dist : null,
          compose:
            process.env.RELAY_SHELL_COMPOSE?.trim().toLowerCase() === "pack"
              ? "pack"
              : "primitives",
          decideBackend: process.env.DECIDE_BACKEND?.trim() || "heuristic",
          specV2: true,
          llmProvider: forceStub ? "stub" : llmProvider,
          endpoints: [
            "POST /api/v2/scaffold",
            "POST /api/v2/validate",
            "POST /api/v2/lower",
            "POST /api/v2/evals",
            "POST /api/v2/freeze",
            "POST /api/v2/run",
          ],
        });
        return;
      }

      if (method === "POST" && url.pathname === "/api/v2/scaffold") {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as { intent?: string; stub?: boolean }) : {};
        const out = await handleScaffold(body);
        sendJson(res, out.status, out);
        return;
      }

      if (method === "POST" && url.pathname === "/api/v2/validate") {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as { yaml?: string; body?: unknown }) : {};
        const out = handleValidate(body as { yaml?: string; body?: never });
        sendJson(res, out.status, out);
        return;
      }

      if (method === "POST" && url.pathname === "/api/v2/lower") {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as { yaml?: string; body?: unknown }) : {};
        const out = handleLower(body as { yaml?: string; body?: never });
        sendJson(res, out.status, out);
        return;
      }

      if (method === "POST" && url.pathname === "/api/v2/evals") {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as { yaml?: string; body?: unknown }) : {};
        const out = await handleEvals(body as { yaml?: string; body?: never });
        sendJson(res, out.status, out);
        return;
      }

      if (method === "POST" && url.pathname === "/api/v2/freeze") {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as { yaml?: string; body?: unknown }) : {};
        const out = handleFreeze(body as { yaml?: string; body?: never });
        sendJson(res, out.status, out);
        return;
      }

      if (method === "POST" && url.pathname === "/api/v2/run") {
        const raw = await readBody(req);
        const body = raw
          ? (JSON.parse(raw) as {
              yaml?: string;
              body?: unknown;
              autoApprove?: boolean;
            })
          : {};
        const out = await handleRun(body as {
          yaml?: string;
          body?: never;
          autoApprove?: boolean;
        });
        sendJson(res, out.status, out);
        return;
      }

      if (method === "GET" && url.pathname === "/api/specs") {
        const records = await store.list({ limit: 100 });
        sendJson(res, 200, { records, path: store.path });
        return;
      }

      const one = /^\/api\/specs\/([^/]+)$/.exec(url.pathname);
      if (method === "GET" && one?.[1]) {
        const id = decodeURIComponent(one[1]);
        const bundle = await store.get(id);
        if (!bundle) {
          sendJson(res, 404, { error: `Spec not found: ${id}` });
          return;
        }
        sendJson(res, 200, bundle);
        return;
      }

      if (method === "POST" && url.pathname === "/api/specs") {
        const raw = await readBody(req);
        const body: ComposeSpecBody = raw ? (JSON.parse(raw) as ComposeSpecBody) : {};
        const created = await composeAndBundleSpec(body);
        await store.put(created);
        sendJson(res, 201, {
          id: created.id,
          intent: created.intent,
          spec: created.spec,
          savedAt: created.savedAt,
          appId: created.appId,
          packId: created.packId,
          primitiveIds: created.primitiveIds,
          decideBackend: created.decideBackend,
        });
        return;
      }

      const approve = /^\/api\/specs\/([^/]+)\/approve$/.exec(url.pathname);
      if (method === "POST" && approve?.[1]) {
        const id = decodeURIComponent(approve[1]);
        const bundle = await store.get(id);
        if (!bundle) {
          sendJson(res, 404, { error: `Spec not found: ${id}` });
          return;
        }
        let spec = bundle.spec;
        if (spec.status === "draft") {
          spec = freezeSpec(spec, { frozenBy: "relay-shell" });
        } else if (spec.status === "frozen") {
          spec = markSpecRunning(spec);
        } else {
          sendJson(res, 400, {
            error: `Cannot approve Spec in status "${spec.status}"`,
          });
          return;
        }
        const next = createSpecBundle(bundle.intent, spec, {
          appId: bundle.appId ?? "relay",
        });
        await store.put(next);
        sendJson(res, 200, next);
        return;
      }

      const abort = /^\/api\/specs\/([^/]+)\/abort$/.exec(url.pathname);
      if (method === "POST" && abort?.[1]) {
        const id = decodeURIComponent(abort[1]);
        const bundle = await store.get(id);
        if (!bundle) {
          sendJson(res, 404, { error: `Spec not found: ${id}` });
          return;
        }
        const spec = markSpecAborted(bundle.spec);
        const next = createSpecBundle(bundle.intent, spec, {
          appId: bundle.appId ?? "relay",
        });
        await store.put(next);
        sendJson(res, 200, next);
        return;
      }

      if (dist && method === "GET" && !url.pathname.startsWith("/api")) {
        if (tryServeStatic(res, dist, url.pathname)) return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on("error", reject);
  });

  console.log(`=== Relay · Spec API (shell) ===`);
  console.log(`http://${host}:${port}`);
  console.log(`Spec store: ${store.path}`);
  console.log(
    `Compose: ${
      process.env.RELAY_SHELL_COMPOSE?.trim().toLowerCase() === "pack"
        ? "pack (relay/compose)"
        : "primitives (decide → composeFromPrimitives)"
    }`
  );
  console.log(
    `Decide: ${process.env.DECIDE_BACKEND?.trim() || "heuristic"} (domain packs stay in their apps)`
  );
  if (dist) {
    console.log(`UI (dist): ${dist}`);
  } else if (serveUi) {
    console.log(`UI: requested but dist/ missing — run pnpm build first`);
  } else {
    console.log(`UI: Vite dev (proxy /api) or RELAY_SHELL_SERVE_UI=1 after build`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
