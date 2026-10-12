import type {
  CollectionAdapter,
  GetResult,
  ListFilter,
  ListResult,
  SeriesPayload,
  SeriesPoint,
  SourceConfig,
} from "@relay/admin-shell";
import {
  formatAuthorityLog,
  resolveAuthorityScoreCard,
  type AuthorityScoreCard,
} from "../authority-metrics.js";
import { assertFileSource } from "./sources.js";

/**
 * Authority north-star collection — aggregates promo / visibility / reply / activations
 * from the app data root (source.path = REDDIT_DATA_DIR).
 */
export function createAuthorityCollection(
  source: SourceConfig
): CollectionAdapter {
  assertFileSource(source, "authority");
  const dataDir = source.path;

  return {
    id: "authority",
    label: "Authority",
    source,
    capabilities: {
      list: true,
      get: true,
      series: true,
    },

    async list(_filter: ListFilter = {}): Promise<ListResult> {
      const card = await resolveAuthorityScoreCard(dataDir);
      return {
        columns: [
          { key: "computedAt", label: "Computed" },
          { key: "score", label: "Score" },
          { key: "promoRatio", label: "Promo %" },
          { key: "visibilityRate", label: "Vis %" },
          { key: "replyRate", label: "Reply %" },
          { key: "activations", label: "Activations" },
          { key: "preview", label: "Preview" },
        ],
        rows: [cardToRow(card)],
      };
    },

    async get(id: string): Promise<GetResult | null> {
      if (id !== "scorecard" && id !== "latest") return null;
      const card = await resolveAuthorityScoreCard(dataDir);
      console.log(formatAuthorityLog(card));
      return {
        record: card,
        detail: {
          kind: "authority-scorecard",
          title: "Authority score card",
          subtitle: `score ${card.score.toFixed(3)} · window ${card.windowDays}d`,
          viz: cardToViz(card),
        },
      };
    },

    async series(query: ListFilter = {}): Promise<SeriesPayload> {
      const card = await resolveAuthorityScoreCard(dataDir, {
        windowDays:
          typeof query.windowDays === "number" ? query.windowDays : undefined,
      });
      const point: SeriesPoint = {
        t: card.computedAt,
        runId: "authority",
        score: round3(card.score),
        scoreWithActivations: round3(card.scoreWithActivations),
        promoRatio: round3(card.promoRatio),
        visibilityRate: round3(card.visibilityRate),
        replyRate: round3(card.replyRate),
        attributedActivations: card.attributedActivations,
        attributionJobs: card.attributionJobs,
        helpCount: card.helpCount,
        promoCount: card.promoCount,
        visibilityOk: card.visibilityOk,
        visibilityChecked: card.visibilityChecked,
        replied: card.replied,
        settled: card.settled,
        removed: card.removed,
      };
      return {
        points: [point],
        funnel: {
          scouted: 0,
          jobs: card.attributionJobs,
          approved: card.replied,
          aborted: card.removed,
          failed: 0,
          posted: card.helpCount + card.promoCount,
        },
        authority: cardToSeriesAuthority(card),
      };
    },
  };
}

function cardToRow(card: AuthorityScoreCard): Record<string, unknown> {
  return {
    id: "scorecard",
    computedAt: card.computedAt,
    score: card.score.toFixed(3),
    promoRatio: `${(card.promoRatio * 100).toFixed(1)}%`,
    visibilityRate: `${(card.visibilityRate * 100).toFixed(0)}%`,
    replyRate: `${(card.replyRate * 100).toFixed(0)}%`,
    activations: String(card.attributedActivations),
    preview: [
      card.constraints.promoOk ? null : "promo high",
      card.constraints.visibilityHealthy ? null : "vis low",
      card.constraints.replyHealthy ? null : "reply low",
      `jobs=${card.attributionJobs}`,
    ]
      .filter(Boolean)
      .join(" · ") || "ok",
  };
}

function cardToViz(card: AuthorityScoreCard): Record<string, unknown> {
  return {
    score: card.score,
    scoreWithActivations: card.scoreWithActivations,
    ladder: {
      promoRatio: card.promoRatio,
      visibilityRate: card.visibilityRate,
      replyRate: card.replyRate,
      attributedActivations: card.attributedActivations,
    },
    counts: {
      help: card.helpCount,
      promo: card.promoCount,
      visibilityOk: card.visibilityOk,
      visibilityChecked: card.visibilityChecked,
      replied: card.replied,
      settled: card.settled,
      removed: card.removed,
      attributionJobs: card.attributionJobs,
    },
    constraints: card.constraints,
    windowDays: card.windowDays,
    computedAt: card.computedAt,
  };
}

function cardToSeriesAuthority(card: AuthorityScoreCard): {
  score: number;
  promoRatio: number;
  replyRate: number;
  visibilityRate: number;
  attributedActivations: number;
  attributionJobs: number;
  constraints: AuthorityScoreCard["constraints"];
} {
  return {
    score: card.score,
    promoRatio: card.promoRatio,
    replyRate: card.replyRate,
    visibilityRate: card.visibilityRate,
    attributedActivations: card.attributedActivations,
    attributionJobs: card.attributionJobs,
    constraints: card.constraints,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
