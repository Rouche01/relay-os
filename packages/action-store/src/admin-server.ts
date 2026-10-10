#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadActionStoreEnv } from "./load-env.js";
import { createActionStoreFromEnv } from "./factory.js";
import {
  ACTION_STATUSES,
  deleteAction,
  editActionField,
  getAction,
  isActionStatus,
  listActions,
  setActionStatus,
} from "./admin-ops.js";
import {
  ALLOWLIST_STATUSES,
  deleteJob,
  deleteRun,
  getAllowlistEntry,
  getJob,
  getRun,
  isAllowlistStatus,
  listAllowlist,
  listJobs,
  listRuns,
  patchAllowlistEntry,
  promoteAllowlistEntry,
  rejectAllowlistEntry,
} from "./admin-collections.js";
import { allowlistPath, jobsDir, resolveDataDir, runsDir } from "./data-dir.js";
import type { ActionListFilter, ActionStatus } from "./types.js";

/** Resolved from the running script so CJS `dist/admin-server.js` finds `../public`. */
const PUBLIC_DIR = path.resolve(
  path.dirname(path.resolve(process.argv[1] ?? ".")),
  "../public"
);
const HOST = "127.0.0.1";
const PORT = Number(process.env.ACTION_STORE_ADMIN_PORT ?? "8787");

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, body: string, type: string): void {
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

function parseActionQuery(url: URL): ActionListFilter {
  const filter: ActionListFilter = {};
  const appId = url.searchParams.get("appId") ?? undefined;
  const statusRaw = url.searchParams.get("status");
  const limitRaw = url.searchParams.get("limit");
  if (appId) filter.appId = appId;
  if (statusRaw) {
    const parts = statusRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const statuses = parts.filter(isActionStatus);
    if (statuses.length === 1) filter.status = statuses[0];
    else if (statuses.length > 1) filter.status = statuses as ActionStatus[];
  }
  if (limitRaw) {
    const n = Number(limitRaw);
    if (Number.isFinite(n) && n >= 0) filter.limit = n;
  }
  return filter;
}

function parseLimit(url: URL): number | undefined {
  const limitRaw = url.searchParams.get("limit");
  if (!limitRaw) return undefined;
  const n = Number(limitRaw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) {
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

async function main(): Promise<void> {
  const envFile = loadActionStoreEnv();
  const store = createActionStoreFromEnv();
  const dataDir = resolveDataDir();
  if (envFile) {
    console.log(`Env: ${envFile}`);
  }

  const server = createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

      if (method === "GET" && url.pathname === "/api/meta") {
        sendJson(res, 200, {
          collections: ["actions", "allowlist", "jobs", "runs"],
          statuses: ACTION_STATUSES,
          allowlistStatuses: ALLOWLIST_STATUSES,
          host: HOST,
          port: PORT,
          dataDir,
          storePath: process.env.ACTION_STORE_PATH ?? path.join(dataDir, "actions.json"),
          allowlistPath: allowlistPath(dataDir),
          jobsDir: jobsDir(dataDir),
          runsDir: runsDir(process.env, dataDir),
        });
        return;
      }

      // —— Actions ——
      if (method === "GET" && url.pathname === "/api/actions") {
        const records = await listActions(store, parseActionQuery(url));
        sendJson(res, 200, { records });
        return;
      }

      const oneAction = url.pathname.match(/^\/api\/actions\/([^/]+)$/);
      if (oneAction) {
        const id = decodeURIComponent(oneAction[1]!);
        if (method === "GET") {
          const record = await getAction(store, id);
          if (!record) {
            sendJson(res, 404, { error: `Action not found: ${id}` });
            return;
          }
          sendJson(res, 200, { record });
          return;
        }
        if (method === "PATCH") {
          const raw = await readBody(req);
          const body = JSON.parse(raw || "{}") as { field?: string; value?: unknown };
          if (!body.field) {
            sendJson(res, 400, { error: "body.field is required" });
            return;
          }
          const record = await editActionField(store, id, body.field, body.value);
          sendJson(res, 200, { record });
          return;
        }
        if (method === "DELETE") {
          const removed = await deleteAction(store, id);
          sendJson(res, removed ? 200 : 404, { deleted: removed });
          return;
        }
      }

      const statusMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/status$/);
      if (statusMatch && method === "POST") {
        const id = decodeURIComponent(statusMatch[1]!);
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as { status?: string };
        if (!body.status || !isActionStatus(body.status)) {
          sendJson(res, 400, { error: "body.status must be a valid ActionStatus" });
          return;
        }
        const record = await setActionStatus(store, id, body.status);
        sendJson(res, 200, { record });
        return;
      }

      // —— Allowlist ——
      if (method === "GET" && url.pathname === "/api/allowlist") {
        const statusRaw = url.searchParams.get("status");
        const status =
          statusRaw && isAllowlistStatus(statusRaw) ? statusRaw : undefined;
        const entries = await listAllowlist(dataDir, {
          status,
          limit: parseLimit(url),
        });
        sendJson(res, 200, { entries });
        return;
      }

      const oneAllow = url.pathname.match(/^\/api\/allowlist\/([^/]+)$/);
      if (oneAllow) {
        const name = decodeURIComponent(oneAllow[1]!);
        if (method === "GET") {
          const entry = await getAllowlistEntry(dataDir, name);
          if (!entry) {
            sendJson(res, 404, { error: `Allowlist entry not found: ${name}` });
            return;
          }
          sendJson(res, 200, { entry });
          return;
        }
        if (method === "PATCH") {
          const raw = await readBody(req);
          const body = JSON.parse(raw || "{}") as Record<string, unknown>;
          const entry = await patchAllowlistEntry(dataDir, name, {
            note: body.note as string | undefined,
            score: body.score as number | undefined,
            rulesOk: body.rulesOk as boolean | undefined,
            status: body.status as "postable" | "proposed" | "rejected" | undefined,
            evidence: body.evidence as string | undefined,
          });
          sendJson(res, 200, { entry });
          return;
        }
      }

      const promoteMatch = url.pathname.match(/^\/api\/allowlist\/([^/]+)\/promote$/);
      if (promoteMatch && method === "POST") {
        const name = decodeURIComponent(promoteMatch[1]!);
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as { note?: string };
        const entry = await promoteAllowlistEntry(dataDir, name, body.note);
        sendJson(res, 200, { entry });
        return;
      }

      const rejectMatch = url.pathname.match(/^\/api\/allowlist\/([^/]+)\/reject$/);
      if (rejectMatch && method === "POST") {
        const name = decodeURIComponent(rejectMatch[1]!);
        const entry = await rejectAllowlistEntry(dataDir, name);
        sendJson(res, 200, { entry });
        return;
      }

      // —— Jobs ——
      if (method === "GET" && url.pathname === "/api/jobs") {
        const jobs = await listJobs(dataDir, parseLimit(url));
        sendJson(res, 200, { jobs });
        return;
      }

      const oneJob = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
      if (oneJob) {
        const id = decodeURIComponent(oneJob[1]!);
        if (method === "GET") {
          const job = await getJob(dataDir, id);
          if (!job) {
            sendJson(res, 404, { error: `Job not found: ${id}` });
            return;
          }
          sendJson(res, 200, job);
          return;
        }
        if (method === "DELETE") {
          const deleted = await deleteJob(dataDir, id);
          sendJson(res, deleted ? 200 : 404, { deleted });
          return;
        }
      }

      // —— Runs (read-only + delete) ——
      if (method === "GET" && url.pathname === "/api/runs") {
        const runs = await listRuns(dataDir, process.env, parseLimit(url));
        sendJson(res, 200, { runs });
        return;
      }

      const oneRun = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (oneRun) {
        const id = decodeURIComponent(oneRun[1]!);
        if (method === "GET") {
          const run = await getRun(dataDir, id);
          if (!run) {
            sendJson(res, 404, { error: `Run not found: ${id}` });
            return;
          }
          sendJson(res, 200, run);
          return;
        }
        if (method === "DELETE") {
          const deleted = await deleteRun(dataDir, id);
          sendJson(res, deleted ? 200 : 404, { deleted });
          return;
        }
      }

      if (method === "GET") {
        await serveStatic(res, url.pathname);
        return;
      }

      sendJson(res, 405, { error: "Method not allowed" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: message });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`Relay data admin: http://${HOST}:${PORT}`);
    console.log(`Data dir: ${dataDir}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
