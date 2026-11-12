import type { ComputerEngine } from "@relay/engines-computer";

export interface PhoneLaunchResult {
  success: boolean;
  error?: string;
  vncUrl?: string;
  meta?: Record<string, unknown>;
}

const sleepDefault = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fail(engine: ComputerEngine, error: string): PhoneLaunchResult {
  const vncUrl = engine.getVncUrl() ?? undefined;
  return {
    success: false,
    error: vncUrl ? `${error} (vnc=${vncUrl})` : error,
    vncUrl,
  };
}

/**
 * Launch an Android app by package name (gateway `action.type: "launch"`).
 */
export async function launchPackage(
  engine: ComputerEngine,
  packageName: string,
  settleMs = 2000,
  sleep: (ms: number) => Promise<void> = sleepDefault
): Promise<PhoneLaunchResult> {
  const trimmed = packageName.trim();
  if (!trimmed) {
    return { success: false, error: "launchPackage requires a package name" };
  }

  const launched = await engine.execute({
    type: "action",
    params: { action: { type: "launch", package: trimmed } },
  });
  if (!launched.success) {
    return fail(engine, launched.error ?? "launch(package) failed");
  }

  if (settleMs > 0) {
    await sleep(settleMs);
  }

  return {
    success: true,
    vncUrl: engine.getVncUrl() ?? undefined,
    meta: { package: trimmed, settleMs },
  };
}

/**
 * Open an http(s) or intent uri via gateway launch (no Firefox address bar).
 */
export async function openUri(
  engine: ComputerEngine,
  uri: string,
  settleMs = 2000,
  sleep: (ms: number) => Promise<void> = sleepDefault
): Promise<PhoneLaunchResult> {
  const trimmed = uri.trim();
  if (!trimmed) {
    return { success: false, error: "openUri requires a uri" };
  }

  const launched = await engine.execute({
    type: "action",
    params: { action: { type: "launch", uri: trimmed } },
  });
  if (!launched.success) {
    return fail(engine, launched.error ?? "launch(uri) failed");
  }

  if (settleMs > 0) {
    await sleep(settleMs);
  }

  return {
    success: true,
    vncUrl: engine.getVncUrl() ?? undefined,
    meta: { uri: trimmed, settleMs },
  };
}

/**
 * Launch with optional package and/or uri (at least one required).
 */
export async function launchApp(
  engine: ComputerEngine,
  opts: {
    package?: string;
    uri?: string;
    settleMs?: number;
    sleep?: (ms: number) => Promise<void>;
  }
): Promise<PhoneLaunchResult> {
  const pkg = opts.package?.trim();
  const uri = opts.uri?.trim();
  if (!pkg && !uri) {
    return {
      success: false,
      error: "launchApp requires package and/or uri",
    };
  }

  const settleMs = opts.settleMs ?? 2000;
  const sleep = opts.sleep ?? sleepDefault;

  const launched = await engine.execute({
    type: "action",
    params: {
      action: {
        type: "launch",
        ...(pkg ? { package: pkg } : {}),
        ...(uri ? { uri } : {}),
      },
    },
  });
  if (!launched.success) {
    return fail(engine, launched.error ?? "launch failed");
  }

  if (settleMs > 0) {
    await sleep(settleMs);
  }

  return {
    success: true,
    vncUrl: engine.getVncUrl() ?? undefined,
    meta: { package: pkg, uri, settleMs },
  };
}
