/**
 * Resolve a secret field: literal string, or `env:VAR` / `env:VAR_NAME`.
 * Empty / missing env vars throw so misconfiguration fails closed.
 */
export function resolveSecretRef(
  raw: string,
  env: NodeJS.ProcessEnv = process.env,
  fieldLabel = "secret"
): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`${fieldLabel} is empty`);
  }
  const m = /^env:([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
  if (!m) return trimmed;
  const key = m[1]!;
  const value = env[key];
  if (value === undefined || value === "") {
    throw new Error(
      `${fieldLabel} references env:${key} but it is unset or empty`
    );
  }
  return value;
}
