/**
 * Spec governance API — app-agnostic (Relay shell).
 * Not CommunityEngager-bound. Packs for "New from Intent" use relay/compose.
 *
 *   pnpm --filter @relay/apps-relay-shell api
 *   RELAY_SHELL_SERVE_UI=1 pnpm --filter @relay/apps-relay-shell api   # also serve dist/
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  composeIntentFromSlots,
  createSpecBundle,
  freezeSpec,
  markSpecAborted,
  markSpecRunning,
} from "@relay/protocol";
import { createFileSpecStore } from "@relay/spec-store";
import { relayComposePack } from "./generic-pack.js";

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  return path.resolve(
    process.cwd(),
    process.env.RELAY_DATA_DIR?.trim() || ".data"
  );
}

function distDir(): string | null {
  const override = process.env.RELAY_SHELL_DIST?.trim();
  const dir = override
    ? path.resolve(override)
    : path.join(shellRoot, "dist");
  if (!existsSync(path.join(dir, "index.html"))) return null;
  return dir;
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
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
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(dist, safe === "/" ? "index.html" : safe);
  if (!filePath.startsWith(dist)) return false;

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = path.join(dist, "index.html");
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
        sendJson(res, 200, {
          ok: true,
          store: store.path,
          ui: dist ? dist : null,
        });
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
        const body = raw
          ? (JSON.parse(raw) as {
              goal?: string;
              slots?: Record<string, string | number | boolean | null>;
            })
          : {};
        const goal =
          body.goal?.trim() || "Compose a Spec from Intent under HITL";
        const { intent, spec, packId } = composeIntentFromSlots(
          goal,
          body.slots ?? { dryRun: true, maxJobs: 2 },
          { packs: [relayComposePack] }
        );
        const bundle = createSpecBundle(intent, spec, { appId: "relay" });
        await store.put(bundle);
        sendJson(res, 201, { ...bundle, packId });
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
  console.log(`Pack: relay/compose (domain packs stay in their apps)`);
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
