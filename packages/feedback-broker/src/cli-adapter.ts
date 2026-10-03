import * as readline from "node:readline";
import {
  FeedbackRequest,
  FeedbackResponse,
  FeedbackAction,
} from "@relay/protocol";
import type { FeedbackAdapter } from "./types.js";

export interface CliFeedbackAdapterOptions {
  /** Input stream (default stdin). */
  input?: NodeJS.ReadableStream;
  /** Output stream (default stdout). */
  output?: NodeJS.WritableStream;
}

/**
 * Terminal HITL adapter for local testing.
 *
 * Commands:
 *   approve | a | yes | y     → proceed (approve as-is)
 *   abort   | x | no  | n     → abort
 *   edit: <text>              → proceed with edited body
 *   edit                      → prompt for multiline edit (end with empty line)
 *   retry                     → retry (error/confirmation flows)
 *   <other text>              → proceed with that string as value (choice/freeform)
 */
export class CliFeedbackAdapter implements FeedbackAdapter {
  readonly name = "cli";
  private readonly input: NodeJS.ReadableStream;
  private readonly output: NodeJS.WritableStream;

  constructor(options: CliFeedbackAdapterOptions = {}) {
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
  }

  async present(request: FeedbackRequest): Promise<FeedbackResponse> {
    this.printRequest(request);

    if (request.type === "credential") {
      return this.presentCredential(request);
    }

    const line = (await this.ask("> ")).trim();
    const parsed = await this.parseLine(line, request);

    return {
      requestId: request.id,
      agentId: request.agentId,
      ...parsed,
    };
  }

  private async presentCredential(
    request: FeedbackRequest
  ): Promise<FeedbackResponse> {
    const out = this.output;
    const otpOnly = /\b(otp|2fa|verification code|one-time)\b/i.test(
      request.prompt
    );

    out.write(
      otpOnly
        ? "\n  Enter OTP (or abort):\n"
        : "\n  Enter Reddit username, then password (or abort):\n"
    );

    if (otpOnly) {
      const code = (await this.ask("  OTP> ")).trim();
      if (["abort", "x", "no", "n"].includes(code.toLowerCase())) {
        return {
          requestId: request.id,
          agentId: request.agentId,
          action: "abort",
          value: false,
        };
      }
      return {
        requestId: request.id,
        agentId: request.agentId,
        action: "proceed",
        value: code,
      };
    }

    const username = (await this.ask("  username> ")).trim();
    if (["abort", "x", "no", "n"].includes(username.toLowerCase())) {
      return {
        requestId: request.id,
        agentId: request.agentId,
        action: "abort",
        value: false,
      };
    }
    const password = (await this.ask("  password> ")).trim();
    if (["abort", "x", "no", "n"].includes(password.toLowerCase())) {
      return {
        requestId: request.id,
        agentId: request.agentId,
        action: "abort",
        value: false,
      };
    }

    return {
      requestId: request.id,
      agentId: request.agentId,
      action: "proceed",
      value: `${username}\n${password}`,
    };
  }

  private printRequest(request: FeedbackRequest): void {
    const out = this.output;
    out.write("\n");
    out.write("════════════════════════════════════════\n");
    out.write(` FEEDBACK  ${request.type.toUpperCase()}`);
    out.write(request.required ? "  (required)\n" : "  (optional)\n");
    out.write("════════════════════════════════════════\n");
    out.write(`${request.prompt}\n`);

    const ctx = request.context;
    if (ctx) {
      if (ctx.title) out.write(`\n  Title:  ${ctx.title}\n`);
      if (ctx.url) out.write(`  URL:    ${ctx.url}\n`);
      if (ctx.subjectId) out.write(`  Id:     ${ctx.subjectId}\n`);
      if (ctx.body) {
        out.write("\n  --- body ---\n");
        out.write(`${ctx.body}\n`);
        out.write("  ------------\n");
      }
      if (ctx.details?.length) {
        out.write("\n");
        for (const d of ctx.details) {
          out.write(`  ${d.label}: ${d.value}\n`);
        }
      }
    }

    if (request.options?.length) {
      out.write("\n  Options:\n");
      for (const opt of request.options) {
        out.write(`    - ${opt}\n`);
      }
    }

    out.write(
      "\n  Commands: approve | abort | edit: <text> | retry | <freeform>\n"
    );
  }

  private async parseLine(
    line: string,
    request: FeedbackRequest
  ): Promise<{ action?: FeedbackAction; value?: unknown }> {
    const lower = line.toLowerCase();

    if (lower === "" || ["approve", "a", "yes", "y"].includes(lower)) {
      return {
        action: "proceed",
        value: true,
      };
    }

    if (["abort", "x", "no", "n"].includes(lower)) {
      return { action: "abort", value: false };
    }

    if (lower === "retry") {
      return { action: "retry" };
    }

    if (lower === "edit") {
      this.output.write("  Enter edited text (empty line to finish):\n");
      const edited = await this.readMultiline();
      return { action: "proceed", value: edited };
    }

    if (lower.startsWith("edit:")) {
      const edited = line.slice("edit:".length).trim();
      return { action: "proceed", value: edited };
    }

    // Freeform / choice: treat whole line as value and proceed
    return { action: "proceed", value: line };
  }

  private ask(prompt: string): Promise<string> {
    const rl = readline.createInterface({
      input: this.input,
      output: this.output,
    });

    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  private async readMultiline(): Promise<string> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.ask("  | ");
      if (line === "") break;
      lines.push(line);
    }
    return lines.join("\n");
  }
}
