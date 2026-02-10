# Phase 3 — Background Script Orchestrator

> **Goal:** Implement the "Brain" of the agent. This service worker manages the ReAct loop, maintains conversation context, communicates with the LLM, and orchestrates tool execution across content scripts and offscreen documents.

---

## 1. Architecture

The Background Script (`src/background/background.ts`) is the central hub.

### Core Modules

1.  **AgentLoop (`src/background/agent/loop.ts`)**:
    -   Implements the `Think -> Act -> Observe` cycle.
    -   Manages `AgentStatus` (IDLE, THINKING, ACTING, ERROR).
    -   Handles `STOP` signals.

2.  **ContextManager (`src/background/agent/context.ts`)**:
    -   Maintains `ChatHistory`.
    -   Constructs the System Prompt.
    -   Manages Token Window (truncation/summarization).

3.  **LLMService (`src/background/llm/index.ts`)**:
    -   Abstracts API calls to Cerebras / OpenRouter.
    -   Handles parsing of tool calls from LLM response.

4.  **ToolRegistry (`src/background/tools/registry.ts`)**:
    -   Maps `ToolName` to implementation.
    -   Routes tool calls:
        -   **Content Tools** (click, type, read) -> Send to Content Script.
        -   **System Tools** (clipboard) -> Handle in Background/Offscreen.
        -   **Memory Tools** (remember, recall) -> Send to Memory System.

5.  **Messenger (`src/background/messages.ts`)**:
    -   Typed wrappers for `chrome.runtime.sendMessage` and `chrome.tabs.sendMessage`.

---

## 2. The Agent Loop Flow

1.  **Trigger**: User sends message from Side Panel.
2.  **Snapshot**: Agent requests `DOM_SNAPSHOT` from valid active tab.
3.  **Prompt**: `ContextManager` builds prompt (System + History + Snapshot).
4.  **Inference**: `LLMService` calls API.
5.  **Response Handling**:
    -   **Text**: Stream to Side Panel.
    -   **Tool Call**:
        -   Update Status -> "ACTING".
        -   Execute Tool (await result).
        -   Add Result to History.
        -   **Loop**: Go back to Step 3 (Observation -> New Thought).
6.  **Termination**:
    -   LLM produces final answer -> Update Status "IDLE".
    -   Max turns reached -> Error.

---

## 3. Implementation Plan

### Step 1: LLM Service
-   Implement `Message` and `Completion` types.
-   Setup API client (fetch).
-   Implement `cullSystemPrompt` dynamic construction.

### Step 2: Tool Registry
-   Define `ToolDefinition` interface.
-   Implement routing logic.

### Step 3: The Loop
-   Create the async `runAgentLoop` function.
-   Handle `AbortController` for stopping.

### Step 4: Integration
-   Wire `chrome.runtime.onMessage` to trigger the loop.

---

## 4. Key Challenges

-   **Asynchrony**: Chrome message passing is async. The loop handles this naturally with `await`.
-   **Tab Focus**: The user might switch tabs while agent is running. We must lock onto the `tabId` from the start of the request.
-   **Persistence**: Service workers die. For this MVP, we accept that state dies with the worker (or we use `chrome.storage.session` if needed, but simple in-memory state is fine for short tasks).
