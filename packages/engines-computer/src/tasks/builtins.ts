import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { navigateToUrl } from "./navigate.js";
import type {
  ComputerTask,
  ComputerTaskContext,
  ComputerTaskResult,
} from "./types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function asNumber(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return fallback;
}

/** Navigate the leased desktop to params.url. */
export const openUrlTask: ComputerTask = {
  id: "open_url",
  async run(ctx: ComputerTaskContext): Promise<ComputerTaskResult> {
    const url = asString(ctx.params.url);
    if (!url) {
      return { success: false, error: "open_url requires params.url" };
    }
    const settleMs = asNumber(ctx.params.settleMs, 2000);
    return navigateToUrl(ctx.engine, url, settleMs);
  },
};

/**
 * Screenshot → write PNG (and optional JSON meta) under session.evidenceDir.
 * params.fileStem — basename without extension (default "frame")
 * params.meta — merged into sidecar JSON when present
 * params.writeMeta — default true when meta is set or always write thin sidecar
 */
export const captureFrameTask: ComputerTask = {
  id: "capture_frame",
  async run(ctx: ComputerTaskContext): Promise<ComputerTaskResult> {
    const evidenceDir = asString(ctx.params.evidenceDir) ?? ctx.session.evidenceDir;
    if (!evidenceDir) {
      return { success: false, error: "capture_frame requires evidenceDir" };
    }

    const shot = await ctx.engine.execute({ type: "screenshot", params: {} });
    if (!shot.success || typeof shot.data?.image !== "string") {
      const vncUrl = ctx.engine.getVncUrl() ?? undefined;
      return {
        success: false,
        error: shot.error ?? "screenshot failed",
        vncUrl,
      };
    }

    await mkdir(evidenceDir, { recursive: true });
    const stem =
      asString(ctx.params.fileStem)?.replace(/[^\w.-]+/g, "_") || "frame";
    const pngPath = path.join(evidenceDir, `${stem}.png`);
    const metaPath = path.join(evidenceDir, `${stem}.json`);
    await writeFile(pngPath, Buffer.from(shot.data.image as string, "base64"));

    const vncUrl = ctx.engine.getVncUrl() ?? undefined;
    const extraMeta =
      ctx.params.meta &&
      typeof ctx.params.meta === "object" &&
      !Array.isArray(ctx.params.meta)
        ? (ctx.params.meta as Record<string, unknown>)
        : {};
    const writeMeta = ctx.params.writeMeta !== false;
    const meta = {
      ...extraMeta,
      pngPath,
      vncUrl,
      jobId: ctx.session.jobId,
      capturedAt: new Date().toISOString(),
    };
    if (writeMeta) {
      await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");
    }

    const evidencePaths = writeMeta ? [pngPath, metaPath] : [pngPath];
    return {
      success: true,
      evidencePaths,
      meta,
      vncUrl,
    };
  },
};

/**
 * One lease batch: for each URL, open_url + capture_frame with paced delays.
 * params.urls: string[]
 * params.fileStemPrefix?: string (default "tour")
 * params.settleMs?: number
 * params.paceMs?: number between URLs (default 500)
 */
export const tourUrlsTask: ComputerTask = {
  id: "tour_urls",
  async run(ctx: ComputerTaskContext): Promise<ComputerTaskResult> {
    const raw = ctx.params.urls;
    const urls = Array.isArray(raw)
      ? raw.map((u) => String(u ?? "").trim()).filter(Boolean)
      : [];
    if (urls.length === 0) {
      return { success: false, error: "tour_urls requires params.urls (non-empty)" };
    }

    const settleMs = asNumber(ctx.params.settleMs, 2000);
    const paceMs = asNumber(ctx.params.paceMs, 500);
    const prefix =
      asString(ctx.params.fileStemPrefix)?.replace(/[^\w.-]+/g, "_") || "tour";
    const evidenceDir =
      asString(ctx.params.evidenceDir) ?? ctx.session.evidenceDir;

    const evidencePaths: string[] = [];
    const frames: Array<Record<string, unknown>> = [];
    let vncUrl = ctx.engine.getVncUrl() ?? undefined;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]!;
      const opened = await navigateToUrl(ctx.engine, url, settleMs);
      if (!opened.success) {
        return {
          success: false,
          error: opened.error ?? `tour open failed at index ${i}`,
          evidencePaths,
          vncUrl: opened.vncUrl ?? vncUrl,
          meta: { completed: i, frames },
        };
      }
      vncUrl = opened.vncUrl ?? vncUrl;

      const stem = `${prefix}-${String(i).padStart(2, "0")}`;
      const captured = await captureFrameTask.run({
        ...ctx,
        params: {
          evidenceDir,
          fileStem: stem,
          meta: { url, index: i },
          writeMeta: true,
        },
      });
      if (!captured.success) {
        return {
          success: false,
          error: captured.error ?? `tour capture failed at index ${i}`,
          evidencePaths,
          vncUrl: captured.vncUrl ?? vncUrl,
          meta: { completed: i, frames },
        };
      }
      if (captured.evidencePaths) evidencePaths.push(...captured.evidencePaths);
      if (captured.meta) frames.push(captured.meta);
      vncUrl = captured.vncUrl ?? vncUrl;

      if (paceMs > 0 && i < urls.length - 1) {
        await sleep(paceMs);
      }
    }

    return {
      success: true,
      evidencePaths,
      vncUrl,
      meta: { count: urls.length, frames },
    };
  },
};

/** Default task set shipped with the package. */
export const builtinComputerTasks: ComputerTask[] = [
  openUrlTask,
  captureFrameTask,
  tourUrlsTask,
];
