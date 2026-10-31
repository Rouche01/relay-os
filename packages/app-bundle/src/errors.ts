export class RelayAppBundleError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "RelayAppBundleError";
    this.code = code;
    this.details = details;
  }
}

export function isRelayAppBundleError(
  err: unknown
): err is RelayAppBundleError {
  return err instanceof RelayAppBundleError;
}
