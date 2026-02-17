import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pin, PinOff, Trash2 } from "lucide-react";
import { LearnedSkill, SKILLS_STORAGE_KEY } from "../../skills/types";

interface Props {
  replayPinnedOnly: boolean;
  onReplayPinnedOnlyChange: (value: boolean) => void;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function successRate(skill: LearnedSkill): number {
  const total = skill.successfulRuns + skill.failedRuns;
  if (total <= 0) return 0;
  return Math.round((skill.successfulRuns / total) * 100);
}

function parseSkills(raw: unknown): LearnedSkill[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is LearnedSkill => {
      return (
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as LearnedSkill).id === "string" &&
        typeof (entry as LearnedSkill).name === "string" &&
        Array.isArray((entry as LearnedSkill).steps)
      );
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function LearnedSkillsPanel({
  replayPinnedOnly,
  onReplayPinnedOnlyChange,
}: Props) {
  const [skills, setSkills] = useState<LearnedSkill[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    const result = await chrome.storage.local.get(SKILLS_STORAGE_KEY);
    setSkills(parseSkills(result[SKILLS_STORAGE_KEY]));
  }, []);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const persistSkills = useCallback(async (next: LearnedSkill[]) => {
    await chrome.storage.local.set({ [SKILLS_STORAGE_KEY]: next });
    setSkills(next.sort((a, b) => b.updatedAt - a.updatedAt));
  }, []);

  const togglePinned = useCallback(
    async (id: string) => {
      const now = Date.now();
      const next = skills.map((skill) =>
        skill.id === id ? { ...skill, pinned: !skill.pinned, updatedAt: now } : skill,
      );
      await persistSkills(next);
    },
    [skills, persistSkills],
  );

  const toggleEnabled = useCallback(
    async (id: string) => {
      const now = Date.now();
      const next = skills.map((skill) =>
        skill.id === id
          ? { ...skill, enabled: !skill.enabled, updatedAt: now }
          : skill,
      );
      await persistSkills(next);
    },
    [skills, persistSkills],
  );

  const deleteSkill = useCallback(
    async (id: string) => {
      const next = skills.filter((skill) => skill.id !== id);
      await persistSkills(next);
      if (expanded === id) setExpanded(null);
    },
    [skills, persistSkills, expanded],
  );

  const clearAll = useCallback(async () => {
    if (!confirm("Delete all learned skills?")) return;
    await persistSkills([]);
    setExpanded(null);
  }, [persistSkills]);

  const stats = useMemo(() => {
    const enabled = skills.filter((s) => s.enabled).length;
    const pinned = skills.filter((s) => s.pinned).length;
    return { total: skills.length, enabled, pinned };
  }, [skills]);

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
        Learned Skills
      </h3>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-md border border-warm-200 dark:border-warm-700 p-2">
          <div className="text-warm-500 dark:text-warm-400">Total</div>
          <div className="font-semibold dark:text-warm-100">{stats.total}</div>
        </div>
        <div className="rounded-md border border-warm-200 dark:border-warm-700 p-2">
          <div className="text-warm-500 dark:text-warm-400">Enabled</div>
          <div className="font-semibold dark:text-warm-100">{stats.enabled}</div>
        </div>
        <div className="rounded-md border border-warm-200 dark:border-warm-700 p-2">
          <div className="text-warm-500 dark:text-warm-400">Pinned</div>
          <div className="font-semibold dark:text-warm-100">{stats.pinned}</div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium dark:text-warm-300">
            Replay Pinned Only
          </label>
          <p className="text-xs text-warm-400 dark:text-warm-500">
            Ignore unpinned skills during auto-replay
          </p>
        </div>
        <input
          type="checkbox"
          checked={replayPinnedOnly}
          onChange={(e) => onReplayPinnedOnlyChange(e.target.checked)}
          className="w-4 h-4 text-primary-600 rounded bg-warm-100 border-warm-300 focus:ring-primary-500 dark:focus:ring-primary-600 dark:ring-offset-warm-800 focus:ring-2 dark:bg-warm-700 dark:border-warm-600"
        />
      </div>

      <div className="max-h-56 overflow-auto space-y-2 pr-1">
        {skills.length === 0 && (
          <div className="text-xs text-warm-500 dark:text-warm-400 rounded-md border border-dashed border-warm-300 dark:border-warm-700 p-2">
            No learned skills yet. Run tasks with Teach Mode enabled.
          </div>
        )}

        {skills.map((skill) => (
          <div
            key={skill.id}
            className="rounded-md border border-warm-200 dark:border-warm-700 p-2"
          >
            <button
              className="w-full text-left"
              onClick={() => setExpanded(expanded === skill.id ? null : skill.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium dark:text-warm-200 truncate">
                    {skill.name}
                  </div>
                  <div className="text-[11px] text-warm-500 dark:text-warm-400">
                    {skill.uses} uses | {successRate(skill)}% success |{" "}
                    {formatDuration(skill.avgDurationMs)} |{" "}
                    {Math.round(skill.avgTokens)} tok
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${skill.enabled ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-warm-200 text-warm-600 dark:bg-warm-800 dark:text-warm-300"}`}
                  >
                    {skill.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
              </div>
            </button>

            {expanded === skill.id && (
              <div className="mt-2 space-y-2 text-xs">
                <div className="text-warm-500 dark:text-warm-400 break-all">
                  Match tokens: {skill.matchTokens.join(", ")}
                </div>
                <div className="space-y-1 max-h-32 overflow-auto">
                  {skill.steps.map((step, idx) => (
                    <div
                      key={`${skill.id}-step-${idx}`}
                      className="rounded border border-warm-200 dark:border-warm-700 p-1.5"
                    >
                      <div className="font-medium dark:text-warm-200">
                        {idx + 1}. {step.objective}
                      </div>
                      <div className="text-warm-500 dark:text-warm-400">
                        {step.successCriteria}
                      </div>
                      <div className="text-warm-500 dark:text-warm-400">
                        Tools: {step.allowedTools.join(", ")}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void togglePinned(skill.id)}
                    className="inline-flex items-center gap-1 rounded border border-warm-300 dark:border-warm-600 px-2 py-1 hover:bg-warm-100 dark:hover:bg-warm-800"
                  >
                    {skill.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                    {skill.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    onClick={() => void toggleEnabled(skill.id)}
                    className="rounded border border-warm-300 dark:border-warm-600 px-2 py-1 hover:bg-warm-100 dark:hover:bg-warm-800"
                  >
                    {skill.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => void deleteSkill(skill.id)}
                    className="inline-flex items-center gap-1 rounded border border-red-300 text-red-700 dark:border-red-900/40 dark:text-red-300 px-2 py-1 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <Trash2 size={12} />
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={() => void clearAll()}
        className="w-full flex items-center justify-center gap-2 p-2.5 text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 border border-amber-200 dark:border-amber-900/30 rounded-lg transition-colors text-sm font-medium"
      >
        <Trash2 size={16} />
        Clear Learned Skills
      </button>
    </section>
  );
}
