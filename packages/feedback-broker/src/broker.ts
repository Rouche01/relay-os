import {
  AgentRuntimeEvent,
  FeedbackRequest,
  FeedbackResponse,
} from "@relay/protocol";
import type {
  FeedbackAdapter,
  FeedbackAutoResolve,
  FeedbackHost,
} from "./types.js";

export interface FeedbackBrokerOptions {
  /** Adapter used for required HITL pauses (CLI, Telegram, …). */
  adapter: FeedbackAdapter;
  /**
   * When true (default), optional/`required: false` requests are ignored
   * (runtime already continues without waiting).
   */
  skipOptional?: boolean;
  /**
   * Parallel resolvers raced against `adapter.present` (e.g. watch headed
   * browser until CAPTCHA/login wall clears, then auto-proceed).
   */
  autoResolvers?: FeedbackAutoResolve[];
}

/**
 * In-process broker: listens for FEEDBACK_REQUESTED on a host runtime,
 * delegates to an adapter (and optional auto-resolvers), then provideFeedback.
 */
export class FeedbackBroker {
  private attached = false;
  private readonly skipOptional: boolean;
  private readonly autoResolvers: FeedbackAutoResolve[];
  private readonly onRequest: (req: FeedbackRequest) => void;

  constructor(
    private readonly host: FeedbackHost,
    private readonly options: FeedbackBrokerOptions
  ) {
    this.skipOptional = options.skipOptional !== false;
    this.autoResolvers = options.autoResolvers ?? [];
    this.onRequest = (req) => {
      void this.handleRequest(req);
    };
  }

  /** Start routing FEEDBACK_REQUESTED → adapter → provideFeedback. */
  attach(): void {
    if (this.attached) return;
    this.host.on(AgentRuntimeEvent.FEEDBACK_REQUESTED, this.onRequest);
    this.attached = true;
  }

  /** Stop listening. */
  detach(): void {
    if (!this.attached) return;
    this.host.off(AgentRuntimeEvent.FEEDBACK_REQUESTED, this.onRequest);
    this.attached = false;
  }

  get adapter(): FeedbackAdapter {
    return this.options.adapter;
  }

  private async handleRequest(req: FeedbackRequest): Promise<void> {
    if (this.skipOptional && !req.required) {
      return;
    }

    const ac = new AbortController();
    try {
      const response = await this.racePresent(req, ac);
      ac.abort();
      await this.host.provideFeedback(normalizeResponse(req, response));
    } catch (err) {
      ac.abort();
      // Surface adapter failures as abort so the agent does not hang WAITING_USER.
      const abort: FeedbackResponse = {
        requestId: req.id,
        agentId: req.agentId,
        action: "abort",
        value: err instanceof Error ? err.message : String(err),
      };
      try {
        await this.host.provideFeedback(abort);
      } catch {
        // Host may already have left WAITING_USER; nothing more to do.
      }
    }
  }

  private async racePresent(
    req: FeedbackRequest,
    ac: AbortController
  ): Promise<FeedbackResponse> {
    const present = this.options.adapter.present(req).then((response) => ({
      source: "adapter" as const,
      response,
    }));

    if (this.autoResolvers.length === 0) {
      const won = await present;
      return won.response;
    }

    const autos = this.autoResolvers.map((resolver) =>
      resolver(req, ac.signal).then((response) => ({
        source: "auto" as const,
        response,
      }))
    );

    const won = await Promise.race([present, ...autos]);
    ac.abort();

    if (won.source === "auto") {
      console.log(
        `[feedback-broker] auto-resolved ${req.type} (${req.id}) — cancelling adapter present`
      );
      try {
        this.options.adapter.cancelPresent?.(
          req.id,
          normalizeResponse(req, won.response)
        );
      } catch (err) {
        console.warn("[feedback-broker] cancelPresent failed:", err);
      }
    }

    return won.response;
  }
}

function normalizeResponse(
  req: FeedbackRequest,
  response: FeedbackResponse
): FeedbackResponse {
  return {
    ...response,
    requestId: response.requestId || req.id,
    agentId: response.agentId || req.agentId,
  };
}
