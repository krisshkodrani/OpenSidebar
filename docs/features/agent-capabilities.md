# Agent Capabilities

OpenSidebar features a powerful, unified agent system designed for reliability, performance, and transparency.

## Unified Agent Mode

OpenSidebar uses a single **Unified Mode** that combines the speed of parallel execution with the intelligence of adaptive planning. This replaces the previous separate "Speed" and "Normal" modes.

### Key Features

- **Parallel Tool Execution**: The agent can perform multiple non-conflicting actions (like reading several elements or checking multiple checkboxes) in a single turn, significantly speeding up tasks.
- **Dynamic Context Compression**: To maintain performance and reduce costs, the agent automatically compresses conversation history, keeping essential context while discarding verbose details from past turns.
- **Real-Time Streaming**: See the agent's thought process and actions character-by-character as they happen.
- **Per-Turn Message Isolation**: Each agent turn is isolated to prevent context bleeding and ensure cleaner reasoning.

## Progress Tracking & Auto-Recovery

The agent is equipped with a sophisticated **Stuck Detection System** that monitors progress and automatically intervenes when the agent is struggling.

### Intervention Levels

1.  **Nudge (6 Stale Turns)**: If the agent makes no meaningful progress for 6 turns, the system injects a "Nudge" — a hint suggesting alternative strategies (e.g., "Try scrolling," "Check if the element is in a shadow DOM").
2.  **Escalate (12 Stale Turns)**: If stagnation continues, the system **Escalates** to a smarter, more capable model (MiniMax M2.5) with fresh context to tackle the difficult step.
3.  **Fail (20+ Stale Turns)**: If the agent remains stuck, it will eventually stop and report the issue to you, preventing infinite loops.

### Stale Element Recovery

Web pages change dynamically. If the agent tries to interact with an element ID that no longer exists (a "stale element"), the system automatically:
1.  **Detects the error**: Catches the specific "stale element" exception.
2.  **Refreshes the view**: Instantly captures a new DOM snapshot.
3.  **Retries**: Re-attempts the action with the updated element ID.

All of this happens transparently in the background.

## Vision Capabilities

OpenSidebar isn't blind. It can "see" the webpage using advanced Vision LLMs.

-   **`take_screenshot`**: When the agent needs to understand visual layout, charts, or non-text elements, it captures a screenshot.
-   **Vision Analysis**: This image is sent to a specialized Vision Model (configurable, defaults to `qwen/qwen3-vl-235b-a22b-instruct`) which provides a detailed text description back to the agent.
-   **Think Stripping**: Internal "thought processes" of the vision model are stripped out, keeping the context clean and focused on the visual data.

## Performance Improvements

-   **Think Stripping**: The UI automatically hides the raw "chain-of-thought" tokens from models that output them, presenting a cleaner, more readable chat interface.
-   **Optimized Streaming**: Improved server-sent events (SSE) handling ensures smoother text generation and tool execution updates.
