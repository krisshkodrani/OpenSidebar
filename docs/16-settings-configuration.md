# Phase 2a — Settings & Configuration

> **Goal:** Implement the SettingsDrawer component, persist user settings via `chrome.storage.sync`, propagate settings changes across all extension contexts, and apply the theme (dark mode) toggle.

---

## Background

The side panel currently has a Zustand store with a `settings` field and an `updateSettings` action, but there is no UI to edit settings and no persistence. The `UserSettings` type and `SETTINGS_UPDATE` message type are already defined in `src/types/index.ts`. The `SettingsDrawer` component is fully spec'd in the Phase 2 RFC but was never built.

This is a standard Chrome extension pattern: store settings in `chrome.storage.sync` (which syncs across devices), load them on mount, and broadcast changes to the service worker.

---

## Design

### Settings Flow

```
SettingsDrawer (React)
    │
    ├─ Local: useStore().updateSettings(patch)
    │
    ├─ Persist: chrome.storage.sync.set({ "qsidebar:settings": mergedSettings })
    │
    └─ Broadcast: chrome.runtime.sendMessage({ type: "SETTINGS_UPDATE", payload: { settings: patch } })
            │
            ▼
       background.ts listener
            │
            └─ Updates in-memory settings cache
            └─ Passes to AgentLoop (maxTurns, API keys)
```

### Files

| File | Change |
|---|---|
| `src/sidepanel/components/SettingsDrawer.tsx` | **NEW** — Full settings UI |
| `src/sidepanel/components/index.ts` | Re-export SettingsDrawer |
| `src/sidepanel/App.tsx` | Add settings drawer toggle state + render |
| `src/sidepanel/store.ts` | Add `loadSettings()` action |
| `src/background/background.ts` | Add `SETTINGS_UPDATE` handler, load settings on startup |

---

## Implementation Details

### `src/sidepanel/components/SettingsDrawer.tsx`

```typescript
import React from "react";
import { UserSettings } from "../../types";

interface SettingsDrawerProps {
  settings: UserSettings;
  onUpdate: (patch: Partial<UserSettings>) => void;
  onClose: () => void;
}

export function SettingsDrawer({ settings, onUpdate, onClose }: SettingsDrawerProps) {
  const save = (patch: Partial<UserSettings>) => {
    onUpdate(patch);

    // Persist to chrome.storage.sync
    const merged = { ...settings, ...patch };
    chrome.storage.sync.set({ "qsidebar:settings": merged });

    // Broadcast to background
    chrome.runtime.sendMessage({
      type: "SETTINGS_UPDATE",
      requestId: crypto.randomUUID(),
      source: "sidepanel",
      payload: { settings: patch },
    });
  };

  return (
    <div className="absolute inset-0 bg-white dark:bg-gray-900 z-50 overflow-y-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold">Settings</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xl">
          &times;
        </button>
      </div>

      <div className="space-y-4">
        {/* Cerebras API Key */}
        <label className="block">
          <span className="text-sm text-gray-600 dark:text-gray-300">Cerebras API Key</span>
          <input
            type="password"
            value={settings.cerebrasApiKey}
            onChange={(e) => save({ cerebrasApiKey: e.target.value })}
            className="mt-1 block w-full rounded border dark:border-gray-600 px-3 py-2 text-sm dark:bg-gray-800"
            placeholder="sk-..."
          />
        </label>

        {/* OpenRouter API Key */}
        <label className="block">
          <span className="text-sm text-gray-600 dark:text-gray-300">OpenRouter API Key</span>
          <input
            type="password"
            value={settings.openRouterApiKey}
            onChange={(e) => save({ openRouterApiKey: e.target.value })}
            className="mt-1 block w-full rounded border dark:border-gray-600 px-3 py-2 text-sm dark:bg-gray-800"
            placeholder="sk-or-..."
          />
        </label>

        {/* Max Turns Slider */}
        <label className="block">
          <span className="text-sm text-gray-600 dark:text-gray-300">
            Max turns: {settings.maxTurns}
          </span>
          <input
            type="range"
            min={5}
            max={50}
            value={settings.maxTurns}
            onChange={(e) => save({ maxTurns: Number(e.target.value) })}
            className="mt-1 block w-full"
          />
        </label>

        {/* Memory Toggle */}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.memoryEnabled}
            onChange={(e) => save({ memoryEnabled: e.target.checked })}
          />
          <span className="text-sm">Enable Memory (Second Brain)</span>
        </label>

        {/* Workspace Toggle */}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.workspaceEnabled}
            onChange={(e) => save({ workspaceEnabled: e.target.checked })}
          />
          <span className="text-sm">Enable Workspace Isolation</span>
        </label>

        {/* Theme Selector */}
        <label className="block">
          <span className="text-sm text-gray-600 dark:text-gray-300">Theme</span>
          <select
            value={settings.theme}
            onChange={(e) => save({ theme: e.target.value as "light" | "dark" | "system" })}
            className="mt-1 block w-full rounded border dark:border-gray-600 px-3 py-2 text-sm dark:bg-gray-800"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </div>
    </div>
  );
}
```

### App.tsx Integration

Add settings drawer toggle to `App.tsx`:

```typescript
const [showSettings, setShowSettings] = useState(false);
const settings = useStore(s => s.settings);
const updateSettings = useStore(s => s.updateSettings);

// In the JSX, add a settings button to the Header area
// and conditionally render SettingsDrawer:
{showSettings && (
  <SettingsDrawer
    settings={settings}
    onUpdate={updateSettings}
    onClose={() => setShowSettings(false)}
  />
)}
```

### Dark Mode Toggle

Add a `useEffect` in `App.tsx` to apply the theme class:

```typescript
useEffect(() => {
  const root = document.documentElement;
  if (
    settings.theme === "dark" ||
    (settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  ) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}, [settings.theme]);
```

### Loading Settings on Mount

In the store, add a `loadSettings` action:

```typescript
loadSettings: () => {
  chrome.storage.sync.get("qsidebar:settings").then((result) => {
    const saved = result["qsidebar:settings"];
    if (saved) {
      set((state) => {
        Object.assign(state.settings, saved);
      });
    }
  });
},
```

Call `loadSettings()` in the initial `useEffect` in `App.tsx`.

### Background — Settings Handler

In `src/background/background.ts`, add a message handler:

```typescript
if (message.type === "SETTINGS_UPDATE") {
  const patch = message.payload.settings;
  Object.assign(cachedSettings, patch);

  // Persist (redundant with side panel, but ensures background has it)
  chrome.storage.sync.set({ "qsidebar:settings": cachedSettings });

  sendResponse({ ok: true });
  return true;
}
```

And load settings on service worker startup:

```typescript
let cachedSettings: UserSettings = { /* defaults */ };

chrome.storage.sync.get("qsidebar:settings").then((result) => {
  if (result["qsidebar:settings"]) {
    cachedSettings = result["qsidebar:settings"];
  }
});
```

---

## Storage Key

| Key | Storage | Contents |
|---|---|---|
| `qsidebar:settings` | `chrome.storage.sync` | Full `UserSettings` object |

`chrome.storage.sync` is used (not `local`) because:
- It syncs across Chrome installations (logged-in user)
- 100KB total quota is more than enough for settings
- API keys are per-user, not per-device

---

## Edge Cases

| Scenario | Handling |
|---|---|
| No saved settings on first install | Use `DEFAULT_SETTINGS` from store |
| API key changed while agent is running | Takes effect on next agent loop start (new `LLMClient` instance) |
| Storage quota exceeded | `chrome.storage.sync.set` rejects — log error, continue with in-memory settings |
| Settings corrupted in storage | `Object.assign` with defaults means partial data is fine; missing keys use defaults |
| Multiple side panels open | Both write to same storage key; last write wins. Acceptable for settings. |

---

## Testing

Manual testing only — the `SettingsDrawer` is a pure React component with standard form inputs. No algorithmic logic to unit test. Verify:

1. Settings persist across side panel close/reopen
2. API keys are masked (`type="password"`)
3. Theme toggle applies/removes `dark` class on `<html>`
4. Max turns slider updates value display in real time
5. Settings changes are received by the background script

---

## Open Questions

None — this follows standard Chrome extension settings patterns.
