# Privacy Policy

**OpenSidebar** — Chrome Browser Extension
Last updated: 2026-03-15

---

## Summary

OpenSidebar is an open-source browser extension that runs AI-powered tasks in your browser. It follows a **bring-your-own-key (BYOK)** model: you provide your own OpenRouter API key, and all processing happens through that account.

- We do **not** collect, store, or transmit your personal data to our servers.
- We do **not** run analytics, telemetry, or tracking of any kind.
- We do **not** have servers. The extension is entirely client-side.
- All data stays in your browser's local storage and is deleted when you uninstall the extension.

---

## What Data the Extension Accesses

### Page Content

When you give the extension a task, it reads the content of the active browser tab (DOM structure, visible text, page title, URL, and a screenshot of the visible area). This is necessary for the AI agent to understand the page and perform the actions you request.

Page content is **only accessed when you actively send a task**. The extension does not passively monitor, index, or record your browsing activity.

### Cookies, History, and Downloads

The extension has permissions for `cookies`, `history`, and `downloads`. These are used exclusively through agent tools that you can trigger via chat commands (e.g., "download this file", "clear cookies for this site", "search my history for..."). These APIs are **never called automatically** — they only execute when the AI agent determines they are needed to fulfill your explicit request, and high-risk operations require your approval.

---

## What Data Is Stored Locally

All extension data is stored in your browser using Chrome's built-in storage APIs (`chrome.storage.local`, `chrome.storage.sync`, `chrome.storage.session`). This includes:

| Data | Storage | Purpose |
|------|---------|---------|
| OpenRouter API key | `chrome.storage.local` | Authenticating with OpenRouter's API |
| User settings | `chrome.storage.sync` | Preferences (max turns, theme, model choices) |
| Agent session state | `chrome.storage.session` | Temporary state during active tasks (cleared on browser restart) |
| Workspace data | `chrome.storage.local` | Tab group organization |
| Saved prompts | `chrome.storage.local` | Quick-access prompt templates you create |
| Diagnostic logs | `chrome.storage.local` | Ring buffer of 2,000 structured log entries for debugging |

Chrome encrypts storage data at rest. Synced settings (`chrome.storage.sync`) follow your Chrome profile sync preferences — you can disable Chrome Sync to keep them local.

All stored data is permanently deleted when you uninstall the extension.

---

## What Data Is Sent Externally

### OpenRouter API

When performing a task, the extension sends requests to the [OpenRouter](https://openrouter.ai) API. These requests contain:

- A system prompt describing the agent's capabilities
- The current page context (URL, page title, element list, visible text)
- A screenshot of the visible browser area (JPEG, sent to the perception model)
- Your conversation messages and the agent's prior responses
- Your OpenRouter API key (as an authentication header)

Requests are sent over HTTPS to `https://openrouter.ai/api/v1/chat/completions`.

**OpenRouter routes your request to the AI model you selected.** OpenRouter's own privacy policy governs how they handle API traffic. We encourage you to review it at [openrouter.ai/privacy](https://openrouter.ai/privacy).

The extension does **not** send data to any other external service. There are no first-party servers, no analytics endpoints, and no crash reporters.

### Optional: Local Log Server

If you run the development log server (`npm run logs`), the extension drains diagnostic logs and trace data to `127.0.0.1:7589` on your local machine. This is entirely local, opt-in, and only used during development. It does not transmit data over the internet.

---

## What Data We Collect

**None.** We have no servers, no databases, and no analytics infrastructure. We cannot see your API key, your browsing data, your tasks, or your conversation history.

---

## Permissions Explained

| Permission | Why It's Needed |
|------------|----------------|
| `sidePanel` | The extension's UI lives in Chrome's side panel |
| `storage` | Storing your settings, API key, and session state locally |
| `activeTab` | Reading the current tab's content when you send a task |
| `tabs`, `tabGroups` | Managing workspaces and switching between tabs during multi-tab tasks |
| `scripting` | Injecting the content script that reads page structure and executes actions |
| `webNavigation` | Persisting agent state across page navigations so tasks survive page loads |
| `alarms` | Keeping the service worker alive during long-running tasks |
| `search` | Agent tool: performing web searches on your behalf when requested |
| `downloads` | Agent tool: downloading files when requested |
| `cookies` | Agent tool: reading/setting cookies when requested |
| `history` | Agent tool: searching browser history when requested |
| `<all_urls>` | The agent needs to interact with any website you navigate to |

---

## Third-Party Services

The only third-party service the extension communicates with is **OpenRouter** (`openrouter.ai`), and only using your own API key. OpenRouter in turn routes requests to the AI model provider (e.g., OpenAI, Google, MiniMax) depending on your model selection.

We have no affiliation with OpenRouter beyond using their public API. Your relationship with OpenRouter is governed by their terms of service and privacy policy.

---

## Children's Privacy

OpenSidebar is not directed at children under 13. We do not knowingly collect information from children.

---

## Changes to This Policy

If this policy changes, the updated version will be published in the [GitHub repository](https://github.com/OpenSidebar/OpenSidebar) and the "Last updated" date above will be revised. Since we collect no data, policy changes would only reflect changes in extension functionality or third-party integrations.

---

## Contact

For privacy questions or concerns, open an issue on [GitHub](https://github.com/OpenSidebar/OpenSidebar/issues).

---

## Open Source

OpenSidebar is open source under the [MIT License](LICENSE). You can audit the complete source code to verify every claim in this policy at [github.com/OpenSidebar/OpenSidebar](https://github.com/OpenSidebar/OpenSidebar).
