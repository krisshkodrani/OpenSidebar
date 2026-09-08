import React from "react";
import {
  CheckCircle2,
  ChevronDown,
  KeyRound,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import type { PerceptionRuntimeMode, UserSettings } from "../../../types";
import { DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE } from "../../../types";
import { LLM_MODEL_CONFIG } from "../../../config/model-config";
import { getDefaultExecutorModel } from "../../../utils/executor-model-policy";
import {
  getAvailableProviderStacks,
  resolveAvailableProviderMode,
} from "../../../utils/provider-keys";
import type { ProviderModelOption } from "../../hooks/useOpenRouterModels";
import {
  getProviderModelCatalogNote,
  getProviderModelOptions,
} from "../../hooks/useOpenRouterModels";
import { ModelSelector } from "../ModelSelector";
import { PERCEPTION_MODE_OPTIONS } from "./settings-options";
import type { SettingsChangeHandler } from "./types";

const inputClassName =
  "w-full px-3 py-2 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100";
const hintClassName = "mt-0.5 text-[11px] text-warm-400 dark:text-warm-500";

const API_KEY_FIELDS = [
  {
    key: "openRouterApiKey",
    label: "OpenRouter",
    placeholder: "sk-or-...",
    description: "Full agent stack and live model catalog.",
  },
  {
    key: "fireworksApiKey",
    label: "Fireworks AI",
    placeholder: "fw_...",
    description: "Full agent stack with curated models.",
  },
] as const;

type ActiveProviderMode = NonNullable<UserSettings["providerMode"]>;

function defaultPlannerModel(providerMode: ActiveProviderMode) {
  if (providerMode === "openrouter") return LLM_MODEL_CONFIG.openrouter.planner;
  return LLM_MODEL_CONFIG.fireworks.planner;
}

function defaultWriterModel(providerMode: ActiveProviderMode) {
  return getDefaultExecutorModel(providerMode);
}

export function ModelsSettingsTab({
  formState,
  models,
  modelsError,
  modelsLoading,
  onChange,
  connectionsOnly = false,
  showConnections = true,
}: {
  formState: UserSettings;
  models: ProviderModelOption[];
  modelsError?: string | null;
  modelsLoading: boolean;
  onChange: SettingsChangeHandler;
  connectionsOnly?: boolean;
  showConnections?: boolean;
}) {
  const availableStacks = getAvailableProviderStacks(formState);
  const providerMode = resolveAvailableProviderMode(formState);
  const hasOpenRouterKey = Boolean(formState.openRouterApiKey);
  const connectionFields = [...API_KEY_FIELDS].sort(
    (a, b) =>
      Number(Boolean(formState[b.key]?.trim())) -
      Number(Boolean(formState[a.key]?.trim())),
  );
  const executorModels = providerMode
    ? getProviderModelOptions({
        providerMode,
        role: "executor",
        openRouterModels: models,
      })
    : [];
  const plannerModels = providerMode
    ? getProviderModelOptions({
        providerMode,
        role: "planner",
        openRouterModels: models,
      })
    : [];
  const writerModels = providerMode
    ? getProviderModelOptions({
        providerMode,
        role: "writer",
        openRouterModels: models,
      })
    : [];
  const openRouterCatalogActive = providerMode === "openrouter";

  return (
    <>
      {showConnections ? (
        <section className="space-y-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
              Connections
            </h3>
            <p className="mt-1 text-xs text-warm-500 dark:text-warm-400">
              {formState.inferenceMode === "cloud"
                ? "Account connections are managed securely on opensidebar.com. These fields are only for switching to Direct from this browser."
                : "Direct provider keys stay in this browser."}
            </p>
          </div>
          <div className="overflow-hidden rounded-lg border border-warm-200 bg-white dark:border-warm-700 dark:bg-warm-900">
            {connectionFields.map((field) => (
              <ApiKeyField
                key={field.key}
                id={`provider-key-${field.key}`}
                label={field.label}
                value={formState[field.key] || ""}
                onChange={(value) => onChange(field.key, value)}
                placeholder={field.placeholder}
                description={field.description}
              />
            ))}
          </div>
        </section>
      ) : null}

      {connectionsOnly ? null : (
        <>
          <section className="space-y-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
                AI provider
              </h3>
              <p className="mt-1 text-xs text-warm-500 dark:text-warm-400">
                Choose which provider runs the agent.
              </p>
            </div>
            {availableStacks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-warm-300 bg-warm-100/60 p-4 text-center dark:border-warm-700 dark:bg-warm-800/40">
                <KeyRound
                  size={20}
                  className="mx-auto mb-2 text-warm-400"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium text-warm-700 dark:text-warm-200">
                  Connect an AI provider
                </p>
                <p className="mt-1 text-xs text-warm-500 dark:text-warm-400">
                  Sign in and connect OpenRouter or Fireworks, or configure
                  Direct from this browser under Advanced.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {availableStacks.map((stack) => {
                  const selected = stack.mode === providerMode;
                  return (
                    <button
                      key={stack.mode}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onChange("providerMode", stack.mode)}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        selected
                          ? "border-primary-500 bg-primary-50 ring-1 ring-primary-500/20 dark:bg-primary-900/20"
                          : "border-warm-200 bg-white hover:border-warm-300 hover:bg-warm-100 dark:border-warm-700 dark:bg-warm-900 dark:hover:border-warm-600 dark:hover:bg-warm-800"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-semibold text-warm-900 dark:text-warm-100">
                              {stack.label}
                            </span>
                            {stack.recommended ? (
                              <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
                                Recommended
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-warm-500 dark:text-warm-400">
                            {stack.description}
                          </p>
                        </div>
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                            selected
                              ? "border-primary-500 bg-primary-500 text-white"
                              : "border-warm-300 dark:border-warm-600"
                          }`}
                        >
                          {selected ? (
                            <CheckCircle2 size={14} aria-hidden="true" />
                          ) : null}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {providerMode ? (
            <section className="space-y-3">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck
                    size={18}
                    className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
                      {formState.executorModel || formState.plannerModel
                        ? "Custom model setup active"
                        : "Tested defaults active"}
                    </p>
                    <dl className="mt-2 grid grid-cols-[auto,minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                      <dt className="text-emerald-700/80 dark:text-emerald-300/80">
                        Executor
                      </dt>
                      <dd className="truncate font-mono text-emerald-900 dark:text-emerald-100">
                        {formState.executorModel ||
                          getDefaultExecutorModel(providerMode)}
                      </dd>
                      <dt className="text-emerald-700/80 dark:text-emerald-300/80">
                        Planner
                      </dt>
                      <dd className="truncate font-mono text-emerald-900 dark:text-emerald-100">
                        {formState.plannerModel ||
                          defaultPlannerModel(providerMode)}
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>

              <details className="group overflow-hidden rounded-lg border border-warm-200 bg-white dark:border-warm-700 dark:bg-warm-900">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 hover:bg-warm-100 dark:hover:bg-warm-800">
                  <SlidersHorizontal
                    size={17}
                    className="shrink-0 text-warm-500"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-warm-900 dark:text-warm-100">
                      Advanced model settings
                    </p>
                    <p className="mt-0.5 text-[11px] text-warm-500 dark:text-warm-400">
                      Override models, observation, or routing.
                    </p>
                  </div>
                  <ChevronDown
                    size={15}
                    aria-hidden="true"
                    className="shrink-0 text-warm-400 transition-transform group-open:rotate-180"
                  />
                </summary>

                <div className="space-y-5 border-t border-warm-200 p-3 dark:border-warm-700">
                  {openRouterCatalogActive && modelsError ? (
                    <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                      OpenRouter model catalog unavailable: {modelsError}.
                      Tested defaults remain usable.
                    </p>
                  ) : null}

                  <div className="space-y-1">
                    <label className="text-sm font-medium dark:text-warm-300">
                      Executor
                    </label>
                    <p className="text-xs text-warm-400 dark:text-warm-500">
                      Screenshot understanding, tool execution, and page
                      interaction
                    </p>
                    <p className="text-xs text-warm-500 dark:text-warm-400">
                      {getProviderModelCatalogNote({
                        providerMode,
                        role: "executor",
                        hasOpenRouterKey,
                      })}
                    </p>
                    <ModelSelector
                      value={formState.executorModel || ""}
                      onChange={(value) =>
                        onChange("executorModel", value || undefined)
                      }
                      defaultModel={getDefaultExecutorModel(providerMode)}
                      models={executorModels}
                      loading={openRouterCatalogActive ? modelsLoading : false}
                      filterVisionOnly
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium dark:text-warm-300">
                      Planner
                    </label>
                    <p className="text-xs text-warm-400 dark:text-warm-500">
                      Task decomposition and escalation
                    </p>
                    <p className="text-xs text-warm-500 dark:text-warm-400">
                      {getProviderModelCatalogNote({
                        providerMode,
                        role: "planner",
                        hasOpenRouterKey,
                      })}
                    </p>
                    <ModelSelector
                      value={formState.plannerModel || ""}
                      onChange={(value) =>
                        onChange("plannerModel", value || undefined)
                      }
                      defaultModel={defaultPlannerModel(providerMode)}
                      models={plannerModels}
                      loading={
                        providerMode === "openrouter" ? modelsLoading : false
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium dark:text-warm-300">
                      Writer{" "}
                      <span className="font-normal text-warm-400 dark:text-warm-500">
                        (optional)
                      </span>
                    </label>
                    <p className="text-xs text-warm-400 dark:text-warm-500">
                      Dedicated prose model; leave empty to reuse the executor.
                    </p>
                    <ModelSelector
                      value={formState.writerModel || ""}
                      onChange={(value) =>
                        onChange("writerModel", value || undefined)
                      }
                      defaultModel={defaultWriterModel(providerMode)}
                      models={writerModels}
                      loading={openRouterCatalogActive ? modelsLoading : false}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium dark:text-warm-300">
                      Observation
                    </label>
                    <select
                      value={formState.perceptionMode ?? "auto"}
                      onChange={(event) =>
                        onChange(
                          "perceptionMode",
                          event.target.value as PerceptionRuntimeMode,
                        )
                      }
                      className={inputClassName}
                    >
                      {PERCEPTION_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-warm-400 dark:text-warm-500">
                      {
                        PERCEPTION_MODE_OPTIONS.find(
                          (option) =>
                            option.value ===
                            (formState.perceptionMode ?? "auto"),
                        )?.description
                      }
                    </p>
                    <div className="flex items-center justify-between gap-3 pt-2">
                      <div>
                        <label
                          htmlFor="model-image-budget"
                          className="text-sm font-medium dark:text-warm-300"
                        >
                          Image budget
                        </label>
                        <p className="text-xs text-warm-400 dark:text-warm-500">
                          Estimated image tokens per session
                        </p>
                      </div>
                      <input
                        id="model-image-budget"
                        type="number"
                        min={0}
                        step={1000}
                        value={
                          formState.maxImagePromptTokenEstimate ??
                          DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE
                        }
                        onChange={(event) => {
                          const raw = event.target.value.trim();
                          const next = Number(raw);
                          onChange(
                            "maxImagePromptTokenEstimate",
                            raw && Number.isFinite(next) && next >= 0
                              ? next
                              : undefined,
                          );
                        }}
                        className={`${inputClassName} w-28 text-right`}
                      />
                    </div>
                  </div>

                  {openRouterCatalogActive ? (
                    <div className="flex items-center justify-between py-1">
                      <div>
                        <span className="text-sm font-medium dark:text-warm-300">
                          Nitro routing
                        </span>
                        <p className="mt-0.5 text-xs text-warm-400 dark:text-warm-500">
                          Prefer faster :nitro endpoints
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-label="Nitro routing"
                        aria-checked={Boolean(formState.useNitro)}
                        onClick={() =>
                          onChange("useNitro", !formState.useNitro)
                        }
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                          formState.useNitro
                            ? "bg-primary-600"
                            : "bg-warm-300 dark:bg-warm-600"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                            formState.useNitro
                              ? "translate-x-4"
                              : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
                  ) : null}
                </div>
              </details>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

function ApiKeyField({
  description,
  id,
  label,
  onChange,
  placeholder,
  value,
}: {
  description: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const connected = Boolean(value.trim());
  return (
    <details className="group border-b border-warm-200 last:border-b-0 dark:border-warm-700">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 hover:bg-warm-100 dark:hover:bg-warm-800">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-warm-900 dark:text-warm-200">
              {label}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                connected
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                  : "bg-warm-100 text-warm-500 dark:bg-warm-800 dark:text-warm-400"
              }`}
            >
              {connected ? "Connected" : "Add key"}
            </span>
          </div>
          <p className={`${hintClassName} truncate`}>{description}</p>
        </div>
        <ChevronDown
          size={15}
          aria-hidden="true"
          className="shrink-0 text-warm-400 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-warm-100 bg-warm-50 px-3 py-3 dark:border-warm-800 dark:bg-warm-950/40">
        <label
          htmlFor={id}
          className="mb-1.5 block text-xs font-medium text-warm-600 dark:text-warm-300"
        >
          {label} API key
        </label>
        <input
          id={id}
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={inputClassName}
          placeholder={placeholder}
        />
        <p className="mt-1.5 text-[11px] text-warm-400 dark:text-warm-500">
          Stored locally in this browser. Clear the field to disconnect.
        </p>
      </div>
    </details>
  );
}
