/** Structured host failure — callers map to HTTP / CLI without string scraping. */
export class SpecHostError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "SpecHostError";
    this.code = code;
    this.details = details;
  }
}

export function isSpecHostError(err: unknown): err is SpecHostError {
  return err instanceof SpecHostError;
}
