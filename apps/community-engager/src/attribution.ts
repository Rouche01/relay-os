/**
 * Local attribution ledger — join key between execute jobs and GoStylens UTMs.
 * Product analytics can import `{dataDir}/attribution/*.json` or match on utm_content.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { UtmParams } from "./utm.js";
import { formatUtmLog } from "./utm.js";

export interface AttributionRecord {
  jobId: string;
  draftId?: string;
  subreddit?: string;
  postedUrl?: string;
  intensity?: number;
  utm: UtmParams;
  recordedAt: string;
  dryRun?: boolean;
}

export async function recordAttribution(
  dataDir: string,
  record: AttributionRecord
): Promise<void> {
  const dir = path.join(dataDir, "attribution");
  await mkdir(dir, { recursive: true });
  const key = record.jobId.replace(/:/g, "_");
  const file = path.join(dir, `${key}.json`);
  await writeFile(file, JSON.stringify(record, null, 2), "utf8");
  console.log(
    `[attribution] recorded jobId=${record.jobId} ${formatUtmLog(record.utm)}`
  );
}
