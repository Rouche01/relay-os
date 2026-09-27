import {
  AgentRuntimeEvent,
  FeedbackRequest,
  FeedbackResponse,
} from "@relay/protocol";
import type { FeedbackAdapter, FeedbackHost } from "./types.js";

export interface FeedbackBrokerOptions {
  /** Adapter used for required HITL pauses (CLI, Telegram, …). */
  adapter: FeedbackAdapter;
  /**
   * When true (default), optional/`required: false` requests are ignored
   * (runtime already continues without waiting).
   */
  skipOptional?: boolean;
}

/**
 * In-process broker: listens for FEEDBACK_REQUESTED on a host runtime,
 * delegates to an adapter, then calls provideFeedback.
 */
export class FeedbackBroker {
  private attached = false;
  private readonly skipOptional: boolean;
  private readonly onRequest: (req: FeedbackRequest) => void;

  constructor(
    private readonly host: FeedbackHost,
    private readonly options: FeedbackBrokerOptions
  ) {
    this.skipOptional = options.skipOptional !== false;
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

    try {
      const response = await this.options.adapter.present(req);
      await this.host.provideFeedback(normalizeResponse(req, response));
    } catch (err) {
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
