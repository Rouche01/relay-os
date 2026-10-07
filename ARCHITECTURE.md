# Relay OS — Internet-Native Operating System

> A feedback-driven, AI-native operating system built for the browser, where agentic apps replace traditional applications and the internet is the substrate, not the accessory.

## Vision

Build a browser-based operating system where:
- **Identity** is the root primitive, not the machine
- **Intent** is the primary input, not clicks and menus
- **Agentic apps** replace traditional applications — they act on your behalf, pausing for feedback when needed
- **A universal protocol** defines how agentic apps declare capabilities, request feedback, and compose with each other
- **Execution engines** (browser automation, LLM reasoning, API calls, code execution) are pluggable OS services

### Positioning (layman)

See the root [`README.md`](README.md) for plain-language Relay vs n8n vs Loops, and the **living todo + HITL + runtime** product stack:

> **n8n** wires systems and can optionally ask a human before a node.  
> **Loops** run an agent in a disciplined cycle until gates pass.  
> **Relay** runs an agent that negotiates with a human through a protocol, then acts.  
> **Living todo** is a priority queue of agent jobs; each job plans a manifest, runs stages, and pauses the card when a human must decide.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    BROWSER (PWA Surface)                      │
│                                                              │
│  ┌─────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │ Command  │  │ Agent Cards  │  │ Workspace / Desktop     │ │
│  │ Bar      │  │ (running     │  │ (context-aware panels,  │ │
│  │ (intent  │  │  agents,     │  │  agent output surfaces, │ │
│  │  input)  │  │  feedback    │  │  notifications)         │ │
│  │          │  │  requests)   │  │                         │ │
│  └─────────┘  └──────────────┘  └─────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│              REAL-TIME TRANSPORT LAYER                        │
│              (WebSocket + SSE via Socket.IO)                  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                    CLOUD RUNTIME                              │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                  OS KERNEL SERVICES                     │  │
│  │                                                        │  │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌────────┐ │  │
│  │  │ Intent   │ │ Feedback │ │ Agent      │ │Context │ │  │
│  │  │ Router   │ │ Broker   │ │ Scheduler  │ │Engine  │ │  │
│  │  └──────────┘ └──────────┘ └────────────┘ └────────┘ │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │              AGENTIC APP PROTOCOL                       │  │
│  │         (manifest, lifecycle, feedback spec)             │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │              EXECUTION ENGINES                          │  │
│  │                                                        │  │
│  │  ┌────────┐ ┌──────┐ ┌─────┐ ┌──────┐ ┌───────────┐  │  │
│  │  │Browser │ │ LLM  │ │ API │ │ Code │ │   Comms   │  │  │
│  │  │(Puppet)│ │Router│ │(MCP)│ │(Sand)│ │(Email,etc)│  │  │
│  │  └────────┘ └──────┘ └─────┘ └──────┘ └───────────┘  │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │              INFRASTRUCTURE                             │  │
│  │                                                        │  │
│  │  ┌────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ │  │
│  │  │ Redis  │ │ Database │ │ Firebase │ │ Object     │ │  │
│  │  │(state, │ │(Postgres)│ │ Auth     │ │ Storage    │ │  │
│  │  │ pubsub)│ │          │ │          │ │            │ │  │
│  │  └────────┘ └──────────┘ └──────────┘ └────────────┘ │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## Decisions Made

> [!NOTE]
> **Naming**: **Relay OS** (and the **Relay Protocol**). ✅ Confirmed.

> [!NOTE]
> **MVP Scope**: 2 built-in agentic apps — Newsletter Migrator (evolved from existing HITL scraper) + Web Research Agent. ✅ Confirmed.

> [!NOTE]
> **Auth Provider**: Firebase Auth (existing stack), abstracted behind an `AuthService` interface so it's swappable later (e.g., to Passkeys/WebAuthn). ✅ Confirmed.

> [!NOTE]
> **LLM Provider**: Multi-provider with routing. The OS is model-agnostic — routes to the best model per task type (Gemini Flash for fast classification, Claude/GPT-4o for complex reasoning). No vendor lock-in. ✅ Confirmed.

> [!NOTE]
> **Monetization**: Deferred. Not a priority for MVP.

> [!NOTE]
> **HITL Status**: The existing HITL scraper is local-only (not deployed). Cloud runtime will be built fresh, porting the patterns and code from the local project.

---

## Core System Services

### 1. Intent Router

**Purpose**: Receives natural language intent from the user, resolves it to the right agentic app(s), and spawns the appropriate agent(s).

**How it works**:
```
User types: "Move my Substack subscribers to Mailchimp"
                    │
                    ▼
            ┌──────────────┐
            │ Intent Router │
            │               │
            │ 1. Parse intent (LLM)
            │ 2. Search app registry for matching capabilities
            │ 3. Score & rank matches
            │ 4. If ambiguous → ask user to clarify
            │ 5. Spawn winning agent(s)
            │ 6. Pass structured intent + context
            └──────────────┘
                    │
                    ▼
            Agent: NewsletterMigrator spawned
```

**Implementation**:
- LLM-powered intent classification
- App registry lookup (capabilities matching against manifests)
- Handles multi-agent composition ("this requires TravelAgent + CalendarAgent")
- Falls back to asking user when confidence is low

**Key file**: `apps/server/services/intent-router/`

---

### 2. Feedback Broker

**Purpose**: Manages the bidirectional feedback loop between running agents and the user. Prioritizes, batches, and routes feedback requests to the frontend.

**Evolves from**: Your existing Socket.IO event system (`NW_INTEGRATION_AUTH_OTP_REQ`, `NW_INTEGRATION_AUDIENCE_LIST`, etc.)

**Feedback types** (standardized in the protocol):

| Type | Agent Sends | User Responds | Example |
|------|-------------|---------------|---------|
| `approval` | Action preview | approve / reject | "Book this flight for $450?" |
| `choice` | List of options | selection | "Which audience list?" (your existing `audience_list` event) |
| `freeform` | Question | natural language | "Any hotel preferences?" |
| `credential` | Input request | sensitive data | "Enter your OTP" (your existing `auth_otp_request`) |
| `progress` | Status update | (none — informational) | "Scraping page 42 of 100..." |
| `error` | Error details | retry / abort / modify | "Login failed. Wrong password?" |
| `confirmation` | Final result | confirm / edit | "Here's the exported list. Looks right?" |

**Priority management**:
- Agents needing feedback get surfaced in priority order
- Low-priority updates are batched (e.g., "3 agents have progress updates")
- Critical decisions (payments, deletions) always interrupt

**Key file**: `apps/server/services/feedback-broker/`

---

### 3. Agent Scheduler

**Purpose**: Manages the lifecycle of all running agents. Evolves from your `ChildProcessManager`.

**Lifecycle states**:
```
         ┌─────────┐
         │ PENDING  │ ← Intent received, agent not yet started
         └────┬─────┘
              │ spawn
              ▼
         ┌─────────┐
    ┌───►│ RUNNING  │◄────────────────────┐
    │    └────┬─────┘                     │
    │         │                           │
    │         ├── needs feedback ──►┌──────────────┐
    │         │                    │ WAITING_USER  │
    │         │                    └──────┬────────┘
    │         │                           │ user responds
    │         │◄──────────────────────────┘
    │         │
    │         ├── long-running work ──►┌────────────┐
    │         │                        │ BACKGROUND │
    │         │                        └──────┬─────┘
    │         │◄──────────────────────────────┘
    │         │
    │         ├── delegates to sub-agent ──►┌──────────┐
    │         │                             │ COMPOSED │
    │         │                             └────┬─────┘
    │         │◄─────────────────────────────────┘
    │         │
    │         ▼
    │    ┌──────────┐          ┌───────────┐
    │    │ COMPLETE  │          │ FAILED    │
    │    └──────────┘          └───────────┘
    │
    │    ┌──────────────┐
    └────│ PERSISTENT   │ ← Runs indefinitely (monitors, watchers)
         └──────────────┘
```

**Mapping from existing code**:
| ChildProcessManager | Agent Scheduler |
|---------------------|-----------------|
| `createChildProcess()` | `spawnAgent(manifest, intent, context)` |
| `sendMessageToChild()` | `sendToAgent(agentId, message)` |
| `isChildProcessAlive()` | `getAgentState(agentId)` |
| `killChild()` | `terminateAgent(agentId)` |
| Child process per user | Agent instance per intent |
| Message type routing | Protocol event routing |

**Key file**: `apps/server/services/agent-scheduler/`

---

### 4. Context Engine

**Purpose**: Maintains awareness of what the user is doing, what agents are running, and what information is relevant right now.

**Context includes**:
- Active agents and their states
- Recent user interactions
- User preferences and patterns
- Agent outputs and results (short-term memory)
- Current workspace/focus area

**Implementation (MVP)**:
- Redis-backed session context (what's happening right now)
- Postgres-backed persistent context (user preferences, history)
- Injected into every agent spawn as initial context

**Key file**: `apps/server/services/context-engine/`

---

## Agentic App Protocol

### App Manifest Spec

Every agentic app declares itself with a manifest. This is the equivalent of an Android `AndroidManifest.xml` or a `package.json` for the agentic world.

```typescript
interface AgenticAppManifest {
  // Identity
  name: string;                         // "NewsletterMigrator"
  version: string;                      // "1.0.0"
  description: string;                  // Human-readable description
  author: string;                       // Developer identity

  // Intent matching
  triggers: IntentTrigger[];            // What intents this app handles

  // Capabilities
  capabilities: string[];              // What this app can do
  engines_required: EngineType[];      // Which execution engines it needs
  engines_optional?: EngineType[];     // Optional engines (graceful fallback)

  // Permissions
  permissions: Permission[];            // What user resources it needs access to

  // Workflow
  stages: StageDefinition[];           // Declared workflow stages
  feedback_patterns: FeedbackType[];   // What types of feedback it will request

  // Composition
  composes_with?: string[];            // Other agents it can delegate to
}

interface IntentTrigger {
  pattern: string;                     // "migrate * subscribers"
  description: string;                 // "Migrate newsletter subscribers between platforms"
  examples: string[];                  // ["Move my Substack list to Mailchimp", ...]
  confidence_threshold?: number;       // 0.0 - 1.0
}

interface StageDefinition {
  name: string;                        // "login"
  description: string;                 // "Authenticate with the source platform"
  engine: EngineType;                  // "browser" | "llm" | "api" | "code"
  feedback_points?: FeedbackPoint[];   // Where this stage might pause for user input
  timeout_ms?: number;                 // Max time before escalating
}

interface FeedbackPoint {
  type: FeedbackType;                  // "choice" | "approval" | "credential" | etc.
  description: string;                 // "Select which audience list to migrate"
  required: boolean;                   // Can the agent proceed without this?
}

type EngineType = "browser" | "llm" | "api" | "code" | "data" | "comms";
type FeedbackType = "approval" | "choice" | "freeform" | "credential" | "progress" | "error" | "confirmation";
```

### Example Manifest: Newsletter Migrator

```yaml
name: NewsletterMigrator
version: "1.0.0"
description: "Migrate newsletter subscribers between platforms"
author: "inos-builtin"

triggers:
  - pattern: "migrate * subscribers"
    description: "Migrate newsletter subscribers between platforms"
    examples:
      - "Move my Substack subscribers to Mailchimp"
      - "Export my newsletter list from Substack"
      - "Import subscribers into Mailchimp"

capabilities:
  - newsletter.export
  - newsletter.import
  - data.transform

engines_required:
  - browser
  - llm
engines_optional:
  - api

permissions:
  - user.credentials.newsletter
  - user.data.contacts

stages:
  - name: authenticate_source
    description: "Log into the source newsletter platform"
    engine: browser
    feedback_points:
      - type: credential
        description: "Provide login credentials"
        required: true
      - type: credential
        description: "Provide OTP/2FA code if required"
        required: false

  - name: select_list
    description: "Choose which subscriber list to migrate"
    engine: browser
    feedback_points:
      - type: choice
        description: "Select audience list"
        required: true

  - name: extract_data
    description: "Extract subscriber data from source"
    engine: browser

  - name: authenticate_destination
    description: "Log into the destination platform"
    engine: browser
    feedback_points:
      - type: credential
        description: "Provide destination login credentials"
        required: true

  - name: import_data
    description: "Import subscribers to destination"
    engine: browser
    feedback_points:
      - type: confirmation
        description: "Confirm import of N subscribers"
        required: true

feedback_patterns:
  - credential
  - choice
  - confirmation
  - progress
  - error
```

---

## Execution Engines

### Decide co-processor (not an `EngineType`)

**Decide** is a typed System-1 co-processor (`@relay/engines-decide`), not a stage engine. Stages keep `engine: "browser" | "llm" | …`. Apps inject a `DecisionPort` the same way they inject `PlaywrightEngine`.

```text
Observe / retrieve (Relay owns)
        ↓
@relay/engines-decide  (Choice / Noul / Score + confidence)
        ↓
  act / propose (high confidence + safe policy)
  escalate → Feedback Broker (low confidence / stuck / hard policy)
  irreversible write / allowlist promote → always HITL
```

| Piece | Role |
|-------|------|
| `@relay/protocol` `Decision*` | Shared request/answer types, `routeDecision`, escalate → `FeedbackRequest` |
| `@relay/engines-decide` | `DecisionPort`, heuristic (CI/offline) + Jev backends |
| `@relay/engines-browser` `observePage` | Compact page text + opaque candidate ids; **id→locator stays in Relay** |
| Feedback Broker | Presents escalate as `choice` / `confirmation` / `credential` |

**Hard policy (code, not prompt):** CAPTCHA / prove-humanity never auto-solved; comment submit and allowlist promote to postable always HITL; confidence never overrides those bits.

**First consumer:** CommunityEngager — discover fit (Noul), page-class interstitial, login controls, comment composer targets. Plan: [`.cursor/plans/jev_decide_integration_dd22a99c.plan.md`](.cursor/plans/jev_decide_integration_dd22a99c.plan.md).

Env (ThinkPad overnight defaults to offline-safe heuristic):

| Var | Notes |
|-----|--------|
| `DECIDE_BACKEND` | `heuristic` (default) \| `jev` |
| `JEV_API_KEY` / `JEV_BASE_URL` | Only when `DECIDE_BACKEND=jev` — omit on unattended timers so scout does not hard-fail |
| `DECIDE_*_MIN_CONFIDENCE` | Per-task floors (`DISCOVER`, `INTERSTITIAL`, `LOGIN`, `COMPOSER`) |

### Engine Interface

All execution engines implement a common interface:

```typescript
interface ExecutionEngine {
  type: EngineType;

  /** Execute an action and return the result */
  execute(action: EngineAction): Promise<EngineResult>;

  /** Check if this engine is available and healthy */
  healthCheck(): Promise<boolean>;

  /** Clean up resources */
  teardown(): Promise<void>;
}

interface EngineAction {
  type: string;           // Engine-specific action type
  params: Record<string, any>;
  timeout_ms?: number;
  context?: AgentContext;  // Injected by the OS
}

interface EngineResult {
  success: boolean;
  data?: any;
  error?: string;
  feedback_required?: FeedbackRequest;  // Engine can request user feedback
}
```

### Browser Engine (evolves from PuppeteerBot)

```typescript
class BrowserEngine implements ExecutionEngine {
  type = "browser" as const;

  async execute(action: BrowserAction): Promise<EngineResult> {
    switch (action.type) {
      case "navigate":     // goto URL
      case "interact":     // click, type, select (replaces hardcoded selectors)
      case "extract":      // pull data from page
      case "screenshot":   // capture current state
      case "wait":         // wait for condition
      case "evaluate":     // run JS in page context
    }
  }
}
```

### LLM Engine (Multi-Provider with Routing)

The LLM engine is model-agnostic. A router selects the best provider and model for each task based on speed, cost, quality, and privacy requirements.

```typescript
// --- Router ---
interface LLMRouter {
  route(request: LLMRequest): Promise<LLMResponse>;
}

interface LLMRequest {
  task: LLMTaskType;
  prompt: string;
  context?: any;
  constraints?: {
    max_latency_ms?: number;      // "I need this fast"
    max_cost_cents?: number;      // "Keep it cheap"
    privacy?: "local" | "cloud" | "any";
    quality?: "fast" | "balanced" | "best";
  };
}

type LLMTaskType =
  | "classify"     // Intent classification — fast, cheap
  | "reason"       // Complex reasoning — quality matters
  | "generate"     // Content generation — balanced
  | "understand"   // Parse/extract from content — balanced
  | "plan";        // Multi-step planning — quality matters

// --- Provider Interface ---
interface LLMProvider {
  name: string;                    // "openai" | "anthropic" | "google"
  models: ModelConfig[];

  complete(params: CompletionParams): Promise<CompletionResult>;
  stream(params: CompletionParams): AsyncIterable<StreamChunk>;
}

interface ModelConfig {
  id: string;                      // "gpt-4o-mini"
  provider: string;
  capabilities: LLMTaskType[];     // What this model is good at
  cost_per_1k_input: number;       // For routing decisions
  cost_per_1k_output: number;
  avg_latency_ms: number;          // Observed average
  context_window: number;
  supports_streaming: boolean;
}
```

**Default routing strategy:**

| Task | Speed | Quality | Default Route |
|------|-------|---------|---------------|
| Intent classification | ⚡ Fast | Medium | Gemini Flash / GPT-4o-mini |
| Agent planning | Medium | 🎯 High | Claude Sonnet / GPT-4o |
| Content understanding | Medium | Medium | Gemini Flash / GPT-4o-mini |
| Content generation | Medium | 🎯 High | Claude Sonnet / GPT-4o |
| Quick extraction | ⚡ Fast | Low | Gemini Flash / GPT-4o-mini |

**Key design principles:**
- No vendor lock-in — the OS works with any provider
- Cost-aware — cheap models for cheap tasks, quality models for quality tasks
- Resilient — if one provider is down, fall back to another
- Future-proof — new models slot in via config, no code changes

```typescript
class LLMEngine implements ExecutionEngine {
  type = "llm" as const;
  private router: LLMRouter;

  async execute(action: LLMAction): Promise<EngineResult> {
    return this.router.route({
      task: action.type,
      prompt: action.params.prompt,
      context: action.context,
      constraints: action.params.constraints,
    });
  }
}
```

### API Engine (MCP-compatible)

```typescript
class APIEngine implements ExecutionEngine {
  type = "api" as const;

  async execute(action: APIAction): Promise<EngineResult> {
    switch (action.type) {
      case "call":         // Call an API endpoint
      case "discover":     // Find available MCP tools
      case "authenticate": // Handle API auth (OAuth, API keys)
    }
  }
}
```

---

## Technical Stack

### Frontend (Browser PWA)

| Technology | Purpose | Rationale |
|-----------|---------|-----------|
| **Next.js** | Framework | SSR for initial load, app router, API routes as fallback |
| **TypeScript** | Language | Matches existing codebase |
| **Socket.IO Client** | Real-time transport | Already proven in HITL scraper |
| **Vanilla CSS + CSS Modules** | Styling | Maximum control for OS-level UI |
| **PWA (next-pwa)** | Installable app | Native-like experience, offline shell |
| **Zustand** | Client state | Lightweight, simple, good for real-time updates |

### Backend (Cloud Runtime)

| Technology | Purpose | Rationale |
|-----------|---------|-----------|
| **Node.js + TypeScript** | Runtime | Matches existing codebase |
| **Socket.IO Server** | Real-time transport | Already proven in HITL scraper |
| **Redis** | State, pub/sub, queues | Already in use, perfect for agent state |
| **PostgreSQL** | Persistent storage | User data, agent history, app registry |
| **Firebase Auth** | Identity | Already in use, abstracted behind `AuthService` interface |
| **Puppeteer/Playwright** | Browser engine | Already in use (consider migrating to Playwright) |
| **Bull/BullMQ** | Job queues | Built on Redis, handles agent task scheduling |
| **Multi-provider LLM** | AI inference | Gemini, OpenAI, Anthropic via `LLMRouter` — task-based routing |

### Infrastructure

| Technology | Purpose | Rationale |
|-----------|---------|-----------|
| **Docker** | Containerization | Isolate agent execution environments |
| **Cloud Run / Fly.io** | Hosting | Scalable, container-based, WebSocket support |
| **Cloud Storage (GCS/S3)** | File storage | Agent outputs, user uploads |

---

## Project Structure

```
internet-native-os/
├── apps/
│   ├── web/                          # Next.js PWA (the OS surface)
│   │   ├── app/
│   │   │   ├── layout.tsx            # OS shell layout
│   │   │   ├── page.tsx              # Main workspace
│   │   │   └── (auth)/
│   │   │       └── login/page.tsx
│   │   ├── components/
│   │   │   ├── os-shell/             # Desktop environment
│   │   │   │   ├── CommandBar.tsx     # Intent input (⌘K style)
│   │   │   │   ├── AgentPanel.tsx     # Running agents sidebar
│   │   │   │   ├── WorkspaceArea.tsx  # Main content area
│   │   │   │   └── NotificationTray.tsx
│   │   │   ├── feedback/             # Feedback UI primitives
│   │   │   │   ├── ApprovalCard.tsx
│   │   │   │   ├── ChoiceCard.tsx
│   │   │   │   ├── CredentialInput.tsx
│   │   │   │   ├── FreeformInput.tsx
│   │   │   │   ├── ProgressCard.tsx
│   │   │   │   └── ConfirmationCard.tsx
│   │   │   └── agent-cards/          # Per-agent UI surfaces
│   │   │       └── AgentCard.tsx
│   │   ├── hooks/
│   │   │   ├── useSocket.ts          # Socket.IO connection
│   │   │   ├── useAgents.ts          # Agent state management
│   │   │   └── useFeedback.ts        # Feedback queue management
│   │   ├── stores/
│   │   │   ├── agent-store.ts        # Zustand: running agents
│   │   │   ├── feedback-store.ts     # Zustand: pending feedback
│   │   │   └── context-store.ts      # Zustand: user context
│   │   ├── styles/
│   │   │   ├── globals.css           # Design system tokens
│   │   │   ├── os-shell.module.css
│   │   │   └── feedback.module.css
│   │   └── public/
│   │       └── manifest.json         # PWA manifest
│   │
│   └── server/                       # Cloud runtime
│       ├── app.ts                    # Express + Socket.IO server
│       ├── services/
│       │   ├── intent-router/        # Parses intent → finds agents
│       │   │   ├── index.ts
│       │   │   ├── classifier.ts     # LLM-powered intent classification
│       │   │   └── registry.ts       # App manifest registry
│       │   ├── feedback-broker/      # Manages agent ↔ user feedback
│       │   │   ├── index.ts
│       │   │   ├── priority-queue.ts
│       │   │   └── transport.ts      # Socket.IO event routing
│       │   ├── agent-scheduler/      # Agent lifecycle
│       │   │   ├── index.ts
│       │   │   ├── lifecycle.ts
│       │   │   └── state-machine.ts
│       │   ├── context-engine/       # User context management
│       │   │   └── index.ts
│       │   ├── socket-service/       # Socket.IO setup
│       │   │   └── index.ts
│       │   └── auth-service/         # Auth behind AuthService interface
│       │       ├── index.ts          # AuthService interface
│       │       └── firebase.ts       # Firebase implementation
│       ├── engines/                  # Execution engines
│       │   ├── engine.interface.ts   # Common interface
│       │   ├── browser/              # Puppeteer/Playwright
│       │   │   ├── index.ts
│       │   │   └── browser-pool.ts
│       │   ├── llm/                  # LLM inference (multi-provider)
│       │   │   ├── index.ts          # LLMEngine
│       │   │   ├── router.ts         # LLMRouter (task-based model selection)
│       │   │   ├── router-config.ts  # Default routing rules
│       │   │   └── providers/
│       │   │       ├── provider.interface.ts
│       │   │       ├── openai.ts
│       │   │       ├── anthropic.ts
│       │   │       └── google.ts
│       │   ├── api/                  # MCP-compatible API engine
│       │   │   └── index.ts
│       │   └── code/                 # Sandboxed code execution
│       │       └── index.ts
│       └── agents/                   # Built-in agentic apps
│           ├── newsletter-migrator/  # Evolved from HITL integration-flows
│           │   ├── manifest.yaml
│           │   ├── index.ts          # Agent entry point
│           │   └── stages/
│           │       ├── authenticate.ts
│           │       ├── select-list.ts
│           │       └── extract-data.ts
│           └── web-researcher/       # Second built-in agent
│               ├── manifest.yaml
│               ├── index.ts
│               └── stages/
│
├── packages/
│   ├── protocol/                     # Shared protocol types
│   │   ├── manifest.ts              # AgenticAppManifest type
│   │   ├── feedback.ts              # Feedback event types
│   │   ├── decide.ts                # DecisionPort request/answer + route/escalate
│   │   ├── lifecycle.ts             # Agent lifecycle types
│   │   └── events.ts                # Socket event definitions
│   ├── engines-decide/               # Decide co-processor (Jev / heuristic)
│   ├── engines-browser/              # Playwright + observeCandidates
│   └── shared/                       # Shared utilities
│       └── index.ts
│
├── package.json                      # Monorepo root (pnpm workspaces)
├── pnpm-workspace.yaml
├── turbo.json                        # Turborepo config
├── docker-compose.yml                # Local dev (Redis, Postgres)
├── ARCHITECTURE.md                   # This file
└── README.md
```

---

## MVP Scope — Phase 1

### What We Build

The smallest thing that proves the complete concept end-to-end:

#### 1. OS Shell (Frontend)
- **Command Bar**: ⌘K-style intent input — type what you want in natural language
- **Agent Panel**: Sidebar showing running agents and their states
- **Feedback Surface**: Cards that appear when agents need input (approval, choice, credential, freeform)
- **Workspace Area**: Main area showing agent output/results
- **Auth**: Login with Firebase Auth (behind AuthService interface)

#### 2. Core Services (Backend)
- **Intent Router**: LLM classifies intent → matches to registered agents → spawns
- **Feedback Broker**: Routes feedback events between agents and frontend via Socket.IO
- **Agent Scheduler**: Spawns agents, manages lifecycle states, handles cleanup
- **Context Engine**: Basic session context (active agents, recent results)
- **LLM Router**: Multi-provider model selection per task type

#### 3. Two Built-In Agentic Apps

**App 1: Newsletter Migrator** (direct evolution of HITL scraper)
- Migrate subscribers between Substack ↔ Mailchimp
- Demonstrates: staged workflows, credential feedback, choice feedback, data extraction
- This proves the architecture works because it's already working code being generalized

**App 2: Web Researcher**
- "Research [topic] and summarize findings"
- Uses browser engine to visit pages + LLM engine to analyze/summarize
- Demonstrates: multi-engine composition, progress feedback, freeform feedback
- Simpler flow, shows the system works beyond just scraping

#### 4. Protocol Implementation
- Manifest parser (reads YAML manifests)
- Feedback protocol over Socket.IO (standardized event types)
- Agent lifecycle state machine

### What We Don't Build (Phase 1)

- Agentic app store / third-party apps
- Agent-to-agent composition (A2A protocol)
- Semantic memory / knowledge graph
- Local companion app
- Code execution engine
- MCP integration

---

## Implementation Phases

### Phase 0: The Relay Protocol (Standalone)
Before building the full OS, extract the core interaction mechanics from the HITL scraper into an open-source, engine-agnostic protocol.
- [ ] Initialize `packages/protocol` (TypeScript interfaces and JSON schemas for feedback events).
- [ ] Initialize `packages/runtime` (The orchestrator that runs stages and emits protocol events).
- [ ] Refactor HITL Substack/Mailchimp scraper to be the first app running on the Relay Runtime.

### Phase 1: OS Foundation (Weeks 1–4)

**Week 1–2: Infrastructure + Protocol**
- [ ] Initialize monorepo (pnpm workspaces + Turborepo)
- [ ] Define protocol types (`packages/protocol/`)
- [ ] Set up Next.js app with PWA config
- [ ] Set up Express + Socket.IO server (port patterns from HITL)
- [ ] Docker Compose for Redis + Postgres
- [ ] Firebase Auth integration (port from HITL, wrap in AuthService)

**Week 3–4: Core Services**
- [ ] Agent Scheduler (evolve `ChildProcessManager` patterns)
- [ ] Feedback Broker (evolve Socket.IO event system)
- [ ] Intent Router (LLM classification + manifest matching)
- [ ] Context Engine (basic Redis-backed session)
- [ ] Browser Engine (generalize `PuppeteerBot`)
- [ ] LLM Engine + Router (multi-provider with task-based routing)

### Phase 2: OS Shell + First Agent (Weeks 5–8)

**Week 5–6: OS Shell UI**
- [ ] Design system (tokens, colors, typography)
- [ ] OS Shell layout (command bar, agent panel, workspace)
- [ ] Feedback UI components (all 7 types)
- [ ] Socket.IO integration (real-time agent updates)
- [ ] PWA configuration (installable, offline shell)

**Week 7–8: Newsletter Migrator Agent**
- [ ] Port HITL Substack flow → protocol-compliant agent
- [ ] Port HITL Mailchimp flow → protocol-compliant agent
- [ ] Wire up: intent → spawn → stages → feedback → completion
- [ ] End-to-end test: type intent → agent runs → user provides feedback → data extracted

### Phase 3: Second Agent + Polish (Weeks 9–12)

**Week 9–10: Web Researcher Agent**
- [ ] Build research agent (browser + LLM engines)
- [ ] Multi-engine composition pattern
- [ ] Progress streaming to frontend

**Week 11–12: Polish + Demo**
- [ ] UI polish (animations, transitions, dark mode)
- [ ] Error handling and recovery flows
- [ ] Agent state persistence (survive server restarts)
- [ ] Demo recording / landing page

### Phase 4: Platform (Post-MVP)
- [ ] Third-party agentic app SDK
- [ ] App registry / store
- [ ] Agent-to-agent composition (A2A)
- [ ] MCP integration for API engine
- [ ] Semantic memory / knowledge graph
- [ ] Agent marketplace

---

## Verification Plan

### Automated Tests
- Protocol type validation tests
- Agent lifecycle state machine tests
- Feedback broker routing tests
- Integration tests: spawn agent → receive feedback → respond → completion

### Manual Verification
- End-to-end flow: Open browser → type intent → agent spawns → provides feedback → sees results
- PWA install test: Install as app → verify native-like experience
- Multi-agent test: Run 2 agents simultaneously → verify independent feedback streams
- Failure recovery: Kill agent mid-flow → verify clean error state

### Demo Scenarios
1. **"Move my Substack subscribers to Mailchimp"** → Newsletter Migrator agent activates → walks user through auth → extracts data → imports
2. **"Research the latest developments in CRISPR gene editing"** → Web Researcher agent activates → browses sources → streams progress → delivers summary
