import React from "react";
import type { UserSettings } from "../../../types";
import type { SettingsChangeHandler } from "./types";

const inputClassName =
  "w-full px-3 py-2 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100";

export function VoiceSettingsTab({
  formState,
  onChange,
}: {
  formState: UserSettings;
  onChange: SettingsChangeHandler;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
        OpenAI Realtime
      </h3>
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium dark:text-warm-300">
            Voice mode
          </label>
          <p className="text-xs text-warm-400 dark:text-warm-500">
            Push-to-talk voice control for input, approvals, and spoken harness
            updates.
          </p>
        </div>
        <select
          value={formState.voiceMode || "off"}
          onChange={(event) =>
            onChange("voiceMode", event.target.value as UserSettings["voiceMode"])
          }
          className={inputClassName}
        >
          <option value="off">Off</option>
          <option value="openai_realtime">OpenAI Realtime</option>
        </select>
      </div>
      <p className="text-xs text-warm-400 dark:text-warm-500">
        Requires the local backend to be running with OPENAI_REALTIME_API_KEY or
        OPENAI_API_KEY. The extension uses WebRTC and does not store Realtime
        audio in chat history.
      </p>
    </section>
  );
}
