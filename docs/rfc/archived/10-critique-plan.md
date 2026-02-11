# Implementation Critique & Fix Plan

## Status Review
The core components for Phases 1-4 are implemented.
- **Content**: DOM distillation works.
- **UI**: Side Panel is functional.
- **Background**: Agent loop and tools are wired.
- **Memory**: Offscreen vector store is set up.

## Critique & Identified Issues

### 1. System Prompt Missing Memory Context (Critical)
The `SYSTEM_PROMPT_TEMPLATE` in `src/background/agent/context.ts` does not inform the agent about its "Second Brain".
- **Risk**: Agent won't proactively use `memory_add` or `memory_search` unless tool definitions alone are enough (unreliable).
- **Fix**: Update system prompt to explicitly mention capabilities: "You have a long-term memory. Use 'memory_search' to recall user preferences or project details. Use 'memory_add' to save important facts."

### 2. Service Worker Persistence (Major)
`AgentLoop` and `ContextManager` store state in-memory variables.
- **Risk**: Chrome Service Workers go inactive after ~30 seconds of idleness. **Chat history will be lost** between sparse messages.
- **Fix**: Implement `saveState()` and `loadState()` in `ContextManager` using `chrome.storage.session` (or `local`).

### 3. Type Safety in Vector Store
In `src/offscreen/memory/storage.ts`, `embedding` is cast to `Float32Array`.
- **Risk**: IndexedDB structured cloning works for TypedArrays, but if `Xenova` output changes or serialization quirks occur, calculations might fail.
- **Fix**: Add a safety check/conversion in `cosineSimilarity`.

### 4. LLM Client Error Handling
Need to ensure `LLMClient` handles 401/429 errors gracefully and allows the UI to show them. (Currently logs to console, UI might just hang).

## Action Plan (Phase 4.5: Hardening)

### 1. Update System Prompt
- [ ] Modify `src/background/agent/context.ts`:
    - Add instructions for `memory_add` and `memory_search` in `SYSTEM_PROMPT_TEMPLATE`.

### 2. Implement Context Persistence
- [ ] Modify `src/background/agent/context.ts`:
    - Add `save()`: `chrome.storage.session.set({ 'agent_context': { history, snapshot } })`
    - Add `load()`: `chrome.storage.session.get('agent_context')`
    - Update `constructor` or `AgentLoop` to use `load()`.
- [ ] Test: `tests/background/context.test.ts` (Mock `chrome.storage`).

### 3. Vector Store Safety
- [ ] Modify `src/offscreen/memory/storage.ts`:
    - In `cosineSimilarity`, check `a.length === b.length`.
    - Handle `null`/`undefined` embeddings safely.
- [ ] Test: `tests/offscreen/storage.test.ts`.

## Verification
- **Automated**:
    - `bun test tests/background/context.test.ts`
    - `bun test tests/offscreen/storage.test.ts`
- **Manual**:
    - Build extension.
    - Chat: "My name is Kris." -> Agent should say "Saved to memory".
    - Reload extension (simulate SW restart).
    - Chat: "What is my name?" -> Agent should recall "Kris" (if context or memory persisted).
