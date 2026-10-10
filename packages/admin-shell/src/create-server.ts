import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AdminServerHandle,
  AdminServerOptions,
  CollectionAdapter,
  ListFilter,
} from "./types.js";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sendText(
  res: ServerResponse,
  status: number,
  body: string,
  type: string
): void {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseFilter(url: URL): ListFilter {
  const filter: ListFilter = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (key === "limit") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) filter.limit = n;
      continue;
    }
    filter[key] = value;
  }
  return filter;
}

function defaultPublicDir(): string {
  return path.resolve(
    path.dirname(path.resolve(process.argv[1] ?? ".")),
    "../public"
  );
}

async function serveStatic(
  res: ServerResponse,
  publicDir: string,
  urlPath: string
): Promise<void> {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safe);
  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    const type =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".css"
          ? "text/css; charset=utf-8"
          : ext === ".js"
            ? "text/javascript; charset=utf-8"
            : "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(data);
  } catch {
    sendText(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

function findCollection(
  collections: CollectionAdapter[],
  id: string
): CollectionAdapter | undefined {
  return collections.find((c) => c.id === id);
}

function assertFileSource(adapter: CollectionAdapter): void {
  if (adapter.source.driver === "postgres") {
    throw new Error(
      `Collection "${adapter.id}" uses driver "postgres" which is not implemented yet`
    );
  }
}

/**
 * Loopback admin HTTP server + static SPA.
 * Apps register CollectionAdapters; the shell stays domain-agnostic.
 */
export async function createAdminServer(
  options: AdminServerOptions
): Promise<AdminServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.ADMIN_PORT ?? process.env.ACTION_STORE_ADMIN_PORT ?? "8787");
  const title = options.title ?? "Relay data";
  const publicDir = options.publicDir ?? defaultPublicDir();
  const collections = options.collections;

  for (const c of collections) {
    assertFileSource(c);
  }

  const byId = new Map(collections.map((c) => [c.id, c]));
  if (byId.size !== collections.length) {
    throw new Error("Duplicate collection id in createAdminServer");
  }

  const server = createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);

      if (method === "GET" && url.pathname === "/api/meta") {
        sendJson(res, 200, {
          title,
          host,
          port,
          collections: collections.map((c) => ({
            id: c.id,
            label: c.label,
            source: c.source,
            capabilities: c.capabilities,
          })),
        });
        return;
      }

      const listMatch = url.pathname.match(/^\/api\/collections\/([^/]+)$/);
      if (listMatch && method === "GET") {
        const id = decodeURIComponent(listMatch[1]!);
        const col = findCollection(collections, id);
        if (!col) {
          sendJson(res, 404, { error: `Unknown collection: ${id}` });
          return;
        }
        const result = await col.list(parseFilter(url));
        sendJson(res, 200, result);
        return;
      }

      const seriesMatch = url.pathname.match(
        /^\/api\/collections\/([^/]+)\/series$/
      );
      if (seriesMatch && method === "GET") {
        const id = decodeURIComponent(seriesMatch[1]!);
        const col = findCollection(collections, id);
        if (!col) {
          sendJson(res, 404, { error: `Unknown collection: ${id}` });
          return;
        }
        if (!col.capabilities.series || !col.series) {
          sendJson(res, 404, { error: `Collection "${id}" has no series` });
          return;
        }
        const payload = await col.series(parseFilter(url));
        sendJson(res, 200, payload);
        return;
      }

      const itemMatch = url.pathname.match(
        /^\/api\/collections\/([^/]+)\/items\/([^/]+)$/
      );
      if (itemMatch) {
        const colId = decodeURIComponent(itemMatch[1]!);
        const itemId = decodeURIComponent(itemMatch[2]!);
        const col = findCollection(collections, colId);
        if (!col) {
          sendJson(res, 404, { error: `Unknown collection: ${colId}` });
          return;
        }

        if (method === "GET") {
          const result = await col.get(itemId);
          if (!result) {
            sendJson(res, 404, { error: `Not found: ${itemId}` });
            return;
          }
          sendJson(res, 200, result);
          return;
        }

        if (method === "PATCH") {
          if (!col.capabilities.patch || !col.patch) {
            sendJson(res, 405, { error: `Collection "${colId}" is not patchable` });
            return;
          }
          const raw = await readBody(req);
          const body = JSON.parse(raw || "{}") as Record<string, unknown>;
          const result = await col.patch(itemId, body);
          sendJson(res, 200, result);
          return;
        }

        if (method === "DELETE") {
          if (!col.capabilities.delete || !col.delete) {
            sendJson(res, 405, { error: `Collection "${colId}" is not deletable` });
            return;
          }
          const deleted = await col.delete(itemId);
          sendJson(res, deleted ? 200 : 404, { deleted });
          return;
        }
      }

      const actionMatch = url.pathname.match(
        /^\/api\/collections\/([^/]+)\/items\/([^/]+)\/actions\/([^/]+)$/
      );
      if (actionMatch && method === "POST") {
        const colId = decodeURIComponent(actionMatch[1]!);
        const itemId = decodeURIComponent(actionMatch[2]!);
        const actionName = decodeURIComponent(actionMatch[3]!);
        const col = findCollection(collections, colId);
        if (!col) {
          sendJson(res, 404, { error: `Unknown collection: ${colId}` });
          return;
        }
        const allowed = col.capabilities.actions ?? [];
        if (!allowed.includes(actionName) || !col.action) {
          sendJson(res, 404, {
            error: `Action "${actionName}" not available on "${colId}"`,
          });
          return;
        }
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as Record<string, unknown>;
        const result = await col.action(actionName, itemId, body);
        sendJson(res, 200, result);
        return;
      }

      if (method === "GET") {
        await serveStatic(res, publicDir, url.pathname);
        return;
      }

      sendJson(res, 405, { error: "Method not allowed" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  const url = `http://${host}:${port}`;
  console.log(`${title}: ${url}`);
  for (const c of collections) {
    const loc =
      c.source.driver === "file"
        ? c.source.path
        : `postgres:${c.source.table ?? "default"}`;
    console.log(`  [${c.id}] ${c.source.driver} → ${loc}`);
  }

  return {
    host,
    port,
    url,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
