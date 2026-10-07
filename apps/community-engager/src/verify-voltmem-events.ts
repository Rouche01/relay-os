/**
 * Dogfood verify: episodic addEvent writes stay distinct (no false-merge).
 *
 * Uses a scratch tenant so relay-local production dogfood is untouched.
 * Run: pnpm exec tsx src/verify-voltmem-events.ts
 *   or: node --import tsx src/verify-voltmem-events.ts
 *   or: node dist/verify-voltmem-events.js (after build)
 */
import "dotenv/config";
import { createContextEngine } from "@relay/context-engine";
import { CommunityMemory, communityFactDomain } from "./memory.js";

const TENANT = process.env.VOLTMEM_VERIFY_TENANT?.trim() || "relay-verify-events";

async function main(): Promise<void> {
  const memory = createContextEngine({
    tenantId: TENANT,
    agentId: "community-engager-verify",
    optional: false,
  });

  const healthy = await memory.health();
  if (!healthy) {
    throw new Error(`VoltMem unhealthy at ${process.env.VOLTMEM_URL}`);
  }
  console.log(`[verify] tenant=${TENANT} engine=${memory.name} healthy`);

  const outcomeDomain = communityFactDomain("outcome")!;
  const preferDomain = communityFactDomain("preference")!;
  const rulesDomain = communityFactDomain("rules")!;

  const draftA = {
    id: "reddit-verify-aaa",
    subreddit: "AusFemaleFashion",
    threadUrl: "https://www.reddit.com/r/AusFemaleFashion/comments/verify_aaa/",
    threadTitle: "Verify draft A athletic shorts",
    intensity: 0 as const,
  };
  const draftB = {
    id: "reddit-verify-bbb",
    subreddit: "OutfitPhotos",
    threadUrl: "https://www.reddit.com/r/OutfitPhotos/comments/verify_bbb/",
    threadTitle: "Verify draft B outfit check",
    intensity: 0 as const,
  };

  const eventA = `draft:${draftA.id}:approved`;
  const eventB = `draft:${draftB.id}:approved`;
  const eventPromote = `promote:VerifySubDogfood`;

  const writeA = await memory.addEvent(
    eventA,
    [
      {
        content: CommunityMemory.approved({
          draftId: draftA.id,
          subreddit: draftA.subreddit,
          intensity: draftA.intensity,
          threadUrl: draftA.threadUrl,
          threadTitle: draftA.threadTitle,
        }),
        domain: outcomeDomain,
      },
    ],
    { source: "relay:community-engager-verify" }
  );
  const writeB = await memory.addEvent(
    eventB,
    [
      {
        content: CommunityMemory.approved({
          draftId: draftB.id,
          subreddit: draftB.subreddit,
          intensity: draftB.intensity,
          threadUrl: draftB.threadUrl,
          threadTitle: draftB.threadTitle,
        }),
        domain: outcomeDomain,
      },
    ],
    { source: "relay:community-engager-verify" }
  );
  const writePromote = await memory.addEvent(
    eventPromote,
    [
      {
        content: CommunityMemory.allowlistPromoted("VerifySubDogfood"),
        domain: preferDomain,
      },
      {
        content: CommunityMemory.subredditRules("VerifySubDogfood"),
        domain: rulesDomain,
      },
    ],
    { source: "relay:community-engager-verify" }
  );

  console.log(
    `[verify] write A action=${writeA[0]?.action ?? "?"} id=${writeA[0]?.id ?? "?"}`
  );
  console.log(
    `[verify] write B action=${writeB[0]?.action ?? "?"} id=${writeB[0]?.id ?? "?"}`
  );
  console.log(
    `[verify] promote actions=${writePromote.map((w) => w.action).join(",") || "?"} count=${writePromote.length}`
  );

  if (writeA.length === 0 || writeB.length === 0 || writePromote.length < 2) {
    throw new Error("expected non-empty addEvent results for A, B, and promote (2 facets)");
  }

  const gotA = await memory.getEvent(eventA);
  const gotB = await memory.getEvent(eventB);
  const gotPromote = await memory.getEvent(eventPromote);
  console.log(`[verify] getEvent A=${gotA.length} B=${gotB.length} promote=${gotPromote.length}`);

  if (gotA.length < 1 || gotB.length < 1 || gotPromote.length < 2) {
    throw new Error("getEvent missing facets for A/B/promote");
  }

  const idA = writeA[0]!.id;
  const idB = writeB[0]!.id;
  if (idA === idB) {
    throw new Error(`false-merge: A and B share memory id ${idA}`);
  }

  const prompt = await memory.rememberForPrompt(
    "community draft approved AusFemaleFashion OutfitPhotos VerifySubDogfood",
    { limit: 8 }
  );
  console.log(`[verify] rememberForPrompt chars=${prompt.length}`);
  if (!prompt.includes("[AGENT MEMORY]") || prompt.length < 40) {
    throw new Error("drafter memory block empty or too short");
  }

  // Re-writing same event id should not invent a third distinct draft row
  // that merges with the other draft (idempotent per event).
  const rewriteA = await memory.addEvent(
    eventA,
    [
      {
        content: CommunityMemory.approved({
          draftId: draftA.id,
          subreddit: draftA.subreddit,
          intensity: draftA.intensity,
          threadUrl: draftA.threadUrl,
          threadTitle: draftA.threadTitle,
        }),
        domain: outcomeDomain,
      },
    ],
    { source: "relay:community-engager-verify" }
  );
  console.log(
    `[verify] rewrite A action=${rewriteA[0]?.action ?? "?"} id=${rewriteA[0]?.id ?? "?"}`
  );

  console.log("\n[verify] OK — distinct events, searchable prompt block");
  console.log(`  eventA=${eventA}`);
  console.log(`  eventB=${eventB}`);
  console.log(`  eventPromote=${eventPromote}`);
  console.log(`  tenant=${TENANT}`);
}

main().catch((err) => {
  console.error("[verify] FAILED:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
