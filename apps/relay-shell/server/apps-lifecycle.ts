/**
 * Desk Relay App lifecycle — install → connect → shadow → enable → pause/disable,
 * thaw-to-edit re-requires evals + shadow gate.
 */
import {
  buildRelayAppBundle,
  importRelayAppBundleJson,
  isRelayAppBundleError,
  type RelayAppBundle,
} from "@relay/app-bundle";
import { createLlmEngine } from "@relay/engines-llm";
import {
  createDraftSpecV2,
  freezeSpecV2,
  thawSpecV2,
  toSpecV2Body,
  type ServiceDescriptor,
} from "@relay/protocol";
import {
  generateEvalFixtures,
  hasEvaluableFixtures,
  runEvals,
} from "@relay/spec-evals";
import {
  approveShadowEvidence,
  assertShadowGate,
  createMemoryConnectionStore,
  isSpecHostError,
  listRunSummaries,
  runSpec,
} from "@relay/spec-host";
import { specBodyToYaml } from "@relay/spec-scaffold";
import { parseSpecV2Yaml, validateSpecV2 } from "@relay/spec-validator";
import {
  allConnectionsConnected,
  createInstalledAppFromBundle,
  deleteInstalledApp,
  getInstalledApp,
  listInstalledApps,
  saveInstalledApp,
  toInstalledAppSummary,
  type InstalledRelayApp,
} from "./installed-apps.js";
import {
  buildDeskApiFixtures,
  deskKnownConnections,
  deskRunStateStore,
  loadV2Services,
  runtimeStubLlm,
} from "./spec-v2.js";

function mapError(err: unknown) {
  if (isSpecHostError(err) || isRelayAppBundleError(err)) {
    return {
      ok: false as const,
      status: 422 as const,
      error: err.message,
      code: err.code,
    };
  }
  throw err;
}

function mergeServices(bundle: RelayAppBundle) {
  const curated = loadV2Services();
  const byId = new Map(curated.map((s) => [s.id, s]));
  for (const d of bundle.descriptors) {
    byId.set(d.id, d);
  }
  return [...byId.values()];
}

export async function handleListApps() {
  const apps = listInstalledApps().map(toInstalledAppSummary);
  return { ok: true as const, status: 200, apps };
}

export async function handleGetApp(id: string) {
  const app = getInstalledApp(id);
  if (!app) {
    return { ok: false as const, status: 404, error: `App not found: ${id}` };
  }
  return {
    ok: true as const,
    status: 200,
    app,
    summary: toInstalledAppSummary(app),
    yaml: specBodyToYaml(app.bundle.body),
  };
}

export async function handleInstallApp(input: {
  bundle?: unknown;
  json?: string;
}) {
  try {
    let bundle: RelayAppBundle;
    if (typeof input.json === "string" && input.json.trim()) {
      bundle = importRelayAppBundleJson(input.json);
    } else if (input.bundle != null) {
      bundle = importRelayAppBundleJson(JSON.stringify(input.bundle));
    } else {
      return {
        ok: false as const,
        status: 400,
        error: "Provide bundle object or json string",
      };
    }
    const existing = getInstalledApp(bundle.id);
    const app = createInstalledAppFromBundle(bundle);
    if (existing) {
      // Reinstall keeps connection marks when refs still required.
      for (const ref of bundle.requiredConnections) {
        if (existing.connections[ref]?.connected) {
          app.connections[ref] = { ...existing.connections[ref]! };
        }
      }
    }
    saveInstalledApp(app);
    return {
      ok: true as const,
      status: 200,
      app: toInstalledAppSummary(app),
      note: `Installed ${bundle.id.slice(0, 20)}… — connect secrets, shadow-run, approve evidence, then enable.`,
    };
  } catch (err) {
    return mapError(err);
  }
}

export async function handleUninstallApp(id: string) {
  const ok = deleteInstalledApp(id);
  if (!ok) {
    return { ok: false as const, status: 404, error: `App not found: ${id}` };
  }
  return { ok: true as const, status: 200, deleted: id };
}

export async function handleConnectApp(
  id: string,
  input: { connection?: string; connected?: boolean }
) {
  const app = getInstalledApp(id);
  if (!app) {
    return { ok: false as const, status: 404, error: `App not found: ${id}` };
  }
  const ref = input.connection?.trim();
  if (!ref) {
    return {
      ok: false as const,
      status: 400,
      error: "connection ref required (e.g. github:default)",
    };
  }
  if (!app.bundle.requiredConnections.includes(ref)) {
    return {
      ok: false as const,
      status: 422,
      error: `Connection ${JSON.stringify(ref)} is not required by this app`,
      requiredConnections: app.bundle.requiredConnections,
    };
  }
  const now = new Date().toISOString();
  const connected = input.connected !== false;
  app.connections[ref] = {
    connected,
    connectedAt: connected ? now : undefined,
  };
  app.updatedAt = now;
  saveInstalledApp(app);
  return {
    ok: true as const,
    status: 200,
    app: toInstalledAppSummary(app),
    connections: app.connections,
    note: connected
      ? `Marked ${ref} connected (Desk store — wire live secrets in production).`
      : `Cleared ${ref}`,
  };
}

export async function handleAppShadowRun(
  id: string,
  input: { autoApprove?: boolean } = {}
) {
  const app = getInstalledApp(id);
  if (!app) {
    return { ok: false as const, status: 404, error: `App not found: ${id}` };
  }
  if (app.editing) {
    return {
      ok: false as const,
      status: 422,
      error: "App is thawed for edit — re-freeze (evals gate) before shadow run",
      code: "app_editing",
    };
  }
  if (!allConnectionsConnected(app)) {
    return {
      ok: false as const,
      status: 422,
      error: "Connect all required connections before shadow run",
      code: "connections_incomplete",
      connections: app.connections,
      requiredConnections: app.bundle.requiredConnections,
    };
  }

  const services = mergeServices(app.bundle);
  const connectionStore = createMemoryConnectionStore(
    Object.fromEntries(
      app.bundle.requiredConnections.map((ref) => [
        ref,
        { type: "bearer" as const, token: "desk-installed-token" },
      ])
    )
  );
  const runStateStore = deskRunStateStore();
  const autoApprove = input.autoApprove !== false;

  try {
    const result = await runSpec({
      body: app.bundle.body,
      frozen: app.bundle.frozen,
      services,
      connectionStore,
      llmClient: runtimeStubLlm(),
      mode: "shadow",
      dryRun: true,
      // Desk stays offline; fixtures cover api.* while shadow records simulated writes.
      blockNetwork: true,
      apiFixtures: buildDeskApiFixtures(services),
      hitl: {
        autoApprove,
        pauseAndReturn: !autoApprove,
        runStateStore,
      },
      name: "desk-app-shadow",
      frozenBy: "relay-desk-app",
      context: {
        agentId: "desk-app-1",
        userId: "operator",
        sessionId: `desk-app-${Date.now()}`,
      },
      assertRunnable: false,
      softFailClosed: true,
    });

    const now = new Date().toISOString();
    app.lastShadowRunId = result.runId;
    app.updatedAt = now;
    saveInstalledApp(app);

    return {
      ok: result.ok,
      status: 200 as const,
      runId: result.runId,
      state: result.state,
      specHash: result.specHash,
      evidenceCount: result.evidenceCount,
      simulatedWriteCount: result.simulatedWriteCount,
      app: toInstalledAppSummary(app),
      note:
        result.state === "COMPLETE"
          ? "Shadow run complete — approve evidence, then enable schedule."
          : "Shadow run did not complete — check HITL / errors.",
    };
  } catch (err) {
    return mapError(err);
  }
}

/**
 * On-demand live run for an installed app (manual or scheduled Specs).
 * Requires connections + cleared shadow gate; does not require schedule enabled.
 * HITL pauses for Seats (no auto-approve).
 */
export async function handleAppRunOnce(id: string) {
  const app = getInstalledApp(id);
  if (!app) {
    return { ok: false as const, status: 404, error: `App not found: ${id}` };
  }
  if (app.editing) {
    return {
      ok: false as const,
      status: 422,
      error: "App is thawed for edit — re-freeze + shadow gate before Run once",
      code: "app_editing",
    };
  }
  if (!allConnectionsConnected(app)) {
    return {
      ok: false as const,
      status: 422,
      error: "Connect all required connections before Run once",
      code: "connections_incomplete",
      connections: app.connections,
      requiredConnections: app.bundle.requiredConnections,
    };
  }
  if (app.needsShadowGate) {
    return {
      ok: false as const,
      status: 422,
      error:
        "Shadow evidence not approved — finish Ship gate before Run once",
      code: "shadow_gate_unapproved",
    };
  }

  const services = mergeServices(app.bundle);
  const connectionStore = createMemoryConnectionStore(
    Object.fromEntries(
      app.bundle.requiredConnections.map((ref) => [
        ref,
        { type: "bearer" as const, token: "desk-installed-token" },
      ])
    )
  );
  const runStateStore = deskRunStateStore();
  // Live requires Spec budget.dryRun === false. Frozen wins over body in prepare —
  // override budget on a shallow copy; keep contentHash so runs stay under this app.
  const liveFrozen = {
    ...app.bundle.frozen,
    budget: { ...app.bundle.frozen.budget, dryRun: false as const },
  };
  const liveBody = {
    ...app.bundle.body,
    budget: { ...app.bundle.body.budget, dryRun: false as const },
  };

  try {
    const result = await runSpec({
      body: liveBody,
      frozen: liveFrozen,
      services,
      connectionStore,
      llmClient: runtimeStubLlm(),
      mode: "live",
      dryRun: false,
      // Desk dogfood: fixtures + blocked network; production secrets unlock real IO later.
      blockNetwork: true,
      apiFixtures: buildDeskApiFixtures(services),
      hitl: {
        autoApprove: false,
        pauseAndReturn: true,
        runStateStore,
      },
      name: "desk-app-run-once",
      frozenBy: "relay-desk-app",
      context: {
        agentId: "desk-app-1",
        userId: "operator",
        sessionId: `desk-app-run-${Date.now()}`,
      },
      assertRunnable: false,
      softFailClosed: true,
    });

    const now = new Date().toISOString();
    app.updatedAt = now;
    saveInstalledApp(app);

    // Live budget override changes hashSpecV2(body). Re-key the run record to the
    // installed app hash so Apps → Runs / Seats filters still find it.
    const appHash = app.bundle.specHash;
    if (result.runId && result.specHash !== appHash) {
      const prev = await Promise.resolve(runStateStore.get(result.runId));
      if (prev) {
        await runStateStore.save({ ...prev, specHash: appHash });
      }
    }

    const waiting =
      result.state === "WAITING_USER" ||
      String(result.state).toLowerCase().includes("wait");

    return {
      ok: result.ok || waiting,
      status: 200 as const,
      runId: result.runId,
      state: result.state,
      specHash: appHash,
      evidenceCount: result.evidenceCount,
      app: toInstalledAppSummary(app),
      note: waiting
        ? "Run paused for HITL — open Seats to Approve or Abort."
        : result.state === "COMPLETE"
          ? "Run once complete."
          : "Run once finished — check status / Seats.",
    };
  } catch (err) {
    return mapError(err);
  }
}

export async function handleAppApproveEvidence(
  id: string,
  input: { runId?: string; approvedBy?: string } = {}
) {
  const app = getInstalledApp(id);
  if (!app) {
    return { ok: false as const, status: 404, error: `App not found: ${id}` };
  }
  const runId = input.runId ?? app.lastShadowRunId;
  if (!runId) {
    return {
      ok: false as const,
      status: 422,
      error: "No shadow runId — run shadow first",
    };
  }
  try {
    const run = await approveShadowEvidence(deskRunStateStore(), runId, {
      approvedBy: input.approvedBy ?? "desk-operator",
    });
    if (run.specHash !== app.bundle.specHash) {
      return {
        ok: false as const,
        status: 422,
        error: "Approved run Spec hash does not match installed app",
      };
    }
    const now = new Date().toISOString();
    app.evidenceApprovedAt = run.evidenceApproval?.approvedAt ?? now;
    app.evidenceApprovedRunId = runId;
    app.needsShadowGate = false;
    app.updatedAt = now;
    saveInstalledApp(app);
    return {
      ok: true as const,
      status: 200,
      app: toInstalledAppSummary(app),
      evidenceApproval: run.evidenceApproval,
      note: "Evidence approved — schedule enable unlocked.",
    };
  } catch (err) {
    return mapError(err);
  }
}

export async function handleAppEnable(id: string) {
  const app = getInstalledApp(id);
  if (!app) {
    return { ok: false as const, status: 404, error: `App not found: ${id}` };
  }
  if (app.editing) {
    return {
      ok: false as const,
      status: 422,
      error: "App is thawed — re-freeze + shadow gate before enable",
      code: "app_editing",
    };
  }
  if (!allConnectionsConnected(app)) {
    return {
      ok: false as const,
      status: 422,
      error: "Connect all required connections before enable",
      code: "connections_incomplete",
    };
  }
  try {
    await assertShadowGate({
      store: deskRunStateStore(),
      specHash: app.bundle.specHash,
      runId: app.evidenceApprovedRunId,
    });
    const now = new Date().toISOString();
    app.scheduleState = "enabled";
    app.needsShadowGate = false;
    app.updatedAt = now;
    saveInstalledApp(app);
    return {
      ok: true as const,
      status: 200,
      app: toInstalledAppSummary(app),
      note: "Schedule enabled (logical). Pause or disable from Apps.",
    };
  } catch (err) {
    return mapError(err);
  }
}

export async function handleAppPause(id: string) {
  return setScheduleState(id, "paused", "enabled");
}

export async function handleAppResume(id: string) {
  return setScheduleState(id, "enabled", "paused");
}

export async function handleAppDisable(id: string) {
  return setScheduleState(id, "disabled");
}

function setScheduleState(
  id: string,
  next: InstalledRelayApp["scheduleState"],
  requireCurrent?: InstalledRelayApp["scheduleState"]
) {
  const app = getInstalledApp(id);
  if (!app) {
    return { ok: false as const, status: 404, error: `App not found: ${id}` };
  }
  if (requireCurrent && app.scheduleState !== requireCurrent) {
    return {
      ok: false as const,
      status: 422,
      error: `Schedule is ${app.scheduleState}, expected ${requireCurrent}`,
    };
  }
  if (next === "enabled" && app.needsShadowGate) {
    return {
      ok: false as const,
      status: 422,
      error: "Shadow gate required before enable/resume",
      code: "shadow_gate_unapproved",
    };
  }
  app.scheduleState = next;
  app.updatedAt = new Date().toISOString();
  saveInstalledApp(app);
  return {
    ok: true as const,
    status: 200,
    app: toInstalledAppSummary(app),
  };
}

export async function handleAppRuns(id: string) {
  const app = getInstalledApp(id);
  if (!app) {
    return { ok: false as const, status: 404, error: `App not found: ${id}` };
  }
  const runs = await listRunSummaries(deskRunStateStore(), {
    specHash: app.bundle.specHash,
    limit: 50,
  });
  return { ok: true as const, status: 200, runs, specHash: app.bundle.specHash };
}

/**
 * Thaw installed Spec for edit — disables schedule and re-arms shadow gate.
 */
export async function handleAppThaw(id: string) {
  const app = getInstalledApp(id);
  if (!app) {
    return { ok: false as const, status: 404, error: `App not found: ${id}` };
  }
  const thawed = thawSpecV2(app.bundle.frozen);
  const body = toSpecV2Body(thawed);
  const now = new Date().toISOString();
  app.editing = true;
  app.needsShadowGate = true;
  app.scheduleState = "disabled";
  app.evidenceApprovedAt = undefined;
  app.evidenceApprovedRunId = undefined;
  app.updatedAt = now;
  // Keep frozen record in bundle until refreeze replaces it.
  saveInstalledApp(app);
  return {
    ok: true as const,
    status: 200,
    app: toInstalledAppSummary(app),
    yaml: specBodyToYaml(body),
    body,
    note: "Thawed — edit YAML, then Refreeze (evals gate). Shadow + approve required again before enable.",
  };
}

/**
 * Re-freeze after thaw: evals gate → new frozen Spec in bundle → needs shadow gate.
 */
export async function handleAppRefreeze(
  id: string,
  input: { yaml?: string; body?: unknown; skipEvalsGate?: boolean } = {}
) {
  const app = getInstalledApp(id);
  if (!app) {
    return { ok: false as const, status: 404, error: `App not found: ${id}` };
  }
  if (!app.editing) {
    return {
      ok: false as const,
      status: 422,
      error: "App is not in editing mode — thaw first",
    };
  }

  let body: ReturnType<typeof toSpecV2Body>;
  try {
    if (input.yaml?.trim()) {
      body = parseSpecV2Yaml(input.yaml);
    } else if (input.body && typeof input.body === "object") {
      body = input.body as ReturnType<typeof toSpecV2Body>;
    } else {
      return {
        ok: false as const,
        status: 400,
        error: "Provide yaml or body to refreeze",
      };
    }
  } catch (err) {
    return {
      ok: false as const,
      status: 422,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const services = mergeServices(app.bundle);
  const validation = validateSpecV2(body, {
    services,
    knownConnections: [
      ...new Set([
        ...deskKnownConnections(),
        ...app.bundle.requiredConnections,
      ]),
    ],
  });
  if (!validation.ok) {
    return {
      ok: false as const,
      status: 422,
      error: "Validation failed",
      validation,
    };
  }

  const evals = generateEvalFixtures(body);
  if (!input.skipEvalsGate) {
    if (!hasEvaluableFixtures(evals)) {
      return {
        ok: false as const,
        status: 422,
        error:
          "Cannot refreeze without evaluable hard-rule fixtures (evals gate)",
        evals,
      };
    }
    const evalReport = await runEvals({
      spec: body,
      softFailClosed: false,
      llmEngine: createLlmEngine({ client: runtimeStubLlm() }),
      fixtures: evals,
    });
    if (!evalReport.passed) {
      return {
        ok: false as const,
        status: 422,
        error: "Evals gate failed — fix Spec before refreeze",
        evals,
        evalReport,
      };
    }
  }

  try {
    const draft = createDraftSpecV2({
      ...body,
      id: app.bundle.frozen.id,
    });
    const frozen = freezeSpecV2(draft, { frozenBy: "relay-desk-refreeze" });
    const bundle = buildRelayAppBundle({
      frozen,
      services,
      frozenBy: "relay-desk-refreeze",
      evals,
    });
    const now = new Date().toISOString();
    const next: InstalledRelayApp = {
      ...app,
      id: bundle.id,
      bundle,
      updatedAt: now,
      editing: false,
      needsShadowGate: true,
      scheduleState: "disabled",
      evidenceApprovedAt: undefined,
      evidenceApprovedRunId: undefined,
      lastShadowRunId: undefined,
      connections: Object.fromEntries(
        bundle.requiredConnections.map((ref) => [
          ref,
          app.connections[ref] ?? { connected: false },
        ])
      ),
    };
    // If content id changed, remove old file.
    if (next.id !== app.id) {
      deleteInstalledApp(app.id);
    }
    saveInstalledApp(next);
    return {
      ok: true as const,
      status: 200,
      app: toInstalledAppSummary(next),
      bundleId: next.id,
      note: "Refrozen — shadow-run + approve evidence before enable (shadow gate reset).",
    };
  } catch (err) {
    return mapError(err);
  }
}
