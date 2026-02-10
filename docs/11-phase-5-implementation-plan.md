# Phase 5: Kimi Swarm Implementation Plan

## Goal
Enable the **Reflex Engine** (Cerebras) to delegate complex, multi-page research tasks to the **Deep Thought Engine** (Kimi k2.5 via OpenRouter).

## Proposed Changes

### 1. Type Definitions (Already Implemented)
- **File**: `src/types/index.ts`
- **Status**: `ActivateSwarmArgs` and `ToolName.ACTIVATE_SWARM` are already present. No changes needed.

### 2. Swarm Client
- **File**: `src/background/swarm.ts` (New)
- **Content**:
    - `callKimiSwarm(args: ActivateSwarmArgs): Promise<string>`
    - OpenRouter API client with `moonshotai/kimi-k2.5` model.
    - System/User prompt construction.
    - Retry logic for 429/500 errors.
    - Streaming handling (forwarding chunks to UI if possible, or just accumulating).

### 3. Tool Registration
- **File**: `src/background/tools/index.ts`
- **Change**:
    - Register `activate_swarm` tool.
    - Definition needs to be added (description, parameters).
    - Executor calls `callKimiSwarm`.

### 4. Background Orchestration (Optional/Implicit)
- **File**: `src/background/agent/loop.ts`
- **Change**: The loop already handles tool calls genericall, so no major changes needed unless we want special status updates (e.g., "Consulting Swarm...").
- **Plan**: Update `statusHandler` in tool executor to say "Deep Thought Active...".

## Verification Plan

### Automated Tests
- **File**: `tests/background/swarm.test.ts` (New)
- **Tests**:
    1.  `buildSwarmSystemPrompt` generates correct prompt.
    2.  `callKimiSwarm` handles API success (mocks `fetch`).
    3.  `callKimiSwarm` retries on 500/429.
    4.  `callKimiSwarm` returns error string on failure (doesn't throw).

### Manual Verification
1.  **Setup**: Ensure `openRouterApiKey` is set in Settings.
2.  **Trigger**: Ask QSidebar: "Research the current state of Solid State Batteries and summarize top 3 breakthroughs from 2024."
3.  **Observation**:
    - Agent should call `activate_swarm`.
    - Logs should show "Deep Thought" activity.
    - Final response should be a high-quality summary derived from Kimi's output.
