# LP-8 — Remaining Wiring Spec

The LP-8 cores are built and tested (M1 merged; M2/M3/M4/M5 cores). What remains is
**live wiring** against interfaces that already exist. This spec makes each
remaining stage a fill-in-the-blanks task. It does **not** invent OpenClaw's API —
where the daemon is involved, it states what OpenClaw must expose as a requirement.

Unblock A = a committed/stashed completion-kernel WIP (clean tree).
Unblock B = a running OpenClaw + its API docs.

---

## M2 Stage 2b — extension side (needs Unblock A)

Two new files; the only edit to existing code is one call from the background
entrypoint to start the client.

1. **`background/browser-bridge/agent-runner.ts`** — implement `AgentRunner`
   (`apps/extension/src/background/browser-bridge/handler.ts`):
   - `run({ instruction, url }) → AgentRunOutcome` by starting an `AgentLoop` /
     `orchestrator.startTask` for `instruction` (navigating to `url` first if set).
   - Map the loop result: completed → `{ status: "completed", data/summary }`;
     a clarify/CAPTCHA/auth pause → `{ status: "needs_human", reason }`; failure →
     `{ status: "error", reason }`.
   - Emit one LP-7 span per call (`packages/observability-schema`).

2. **`background/browser-bridge/ws-client.ts`** — a WS client to the host:
   - Connect to `ws://127.0.0.1:${BROWSER_MCP_WS_PORT}`.
   - On `{ id, request }` → `handleBrowserToolRequest(request, runner)` →
     send `{ id, response }`.
   - Reconnect on close (reuse the existing keepalive alarm to revive the SW).

Host side is already done: `WebSocketBridge` (`scripts/browser-mcp/ws-bridge.ts`);
start the host with `BROWSER_MCP_WS_PORT=<port> pnpm run mcp:browser`.

---

## M3 Stage 2b — cache wiring (needs Unblock B)

1. **`KnowledgeStore` impl** (`utils/knowledge-sync.ts` interface) over OpenClaw.
   - **OpenClaw must expose** a namespaced KV: read all items in a namespace, and
     upsert items. Map to `getAll(namespace) → SyncMap` / `putItems(namespace, items)`.

2. **Wire the two knowledge stores** to the cache (replace bespoke storage):
   - `personal-profile.ts` and `website-skills.ts`: back them with
     `new ReadThroughCache(new ChromeStorageLocalSnapshot(), knowledgeStore)` under
     namespaces `"profile"` / `"website-skills"`.
   - Read path → `cache.sync(ns)` then `liveValues`; write path → `cache.put(ns, key, stamp(value))`.
   - Sensitive items keep M1 encryption: encrypt the value before it enters the
     `SyncMap`, decrypt on read — ciphertext is what syncs.

3. **Learning signal**: feed the already-exported graded trajectories
   (`scripts/obs/export-trajectories.ts`) into OpenClaw so skills derive from graded
   outcomes.

---

## M4 Stage 2 — planner routing (needs Unblock B)

1. **`PlannerGateway` impl** (`utils/llm-routing.ts` interface) over OpenClaw.
   - **OpenClaw must expose** a planner/agent completion endpoint that injects
     cross-session memory + site skills. `available()` reflects daemon reachability.
2. **Wire `routePlannerCompletion`** into `TaskPlanner` / the planner pool
   (`background/llm/client.ts`): `viaGateway` = call OpenClaw; `direct` = the existing
   provider call. Executor path unchanged.

---

## M5 — validation (needs Unblock B)

Validate `openclaw/openclaw.config.yaml` keys, the CLI flags, and the onboarding
command in `openclaw/install.sh` against the installed OpenClaw release; run
`install.sh` end-to-end.

## M6 / M7 — post-v1 (deferred by the approved plan)

Queue migration into OpenClaw (span-spine shape) and the remote/AWS gateway are
explicitly out of scope for v1.

---

## Wire protocol (host ↔ extension, already implemented host-side)

```
host → ext:  { "id": "<n>", "request": { "tool": "...", "args": { ... } } }
ext → host:  { "id": "<n>", "response": { "status": "ok|needs_human|error",
                                          "result"?: any, "reason"?: string } }
```
