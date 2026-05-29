import React from "react";
import type { PerceptionRuntimeMode, UserSettings } from "../../../types";
import { DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE } from "../../../types";
import { LLM_MODEL_CONFIG } from "../../../config/model-config";
import { getDefaultExecutorModel } from "../../../utils/executor-model-policy";
import type { ProviderModelOption } from "../../hooks/useOpenRouterModels";
import {
  getProviderModelCatalogNote,
  getProviderModelOptions,
} from "../../hooks/useOpenRouterModels";
import { ModelSelector } from "../ModelSelector";
import {
  getKeyUsage,
  getProviderOneLiner,
  PERCEPTION_MODE_OPTIONS,
} from "./settings-options";
import type { SettingsChangeHandler } from "./types";

const inputClassName =
  "w-full px-3 py-2 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100";
const hintClassName = "mt-0.5 text-[11px] text-warm-400 dark:text-warm-500";

function defaultPlannerModel(providerMode: UserSettings["providerMode"]) {
  if (providerMode === "moonshot") return LLM_MODEL_CONFIG.moonshot.planner;
  if (providerMode === "xiaomi") return LLM_MODEL_CONFIG.xiaomi.planner;
  if (providerMode === "fireworks-deepseek")
    return LLM_MODEL_CONFIG.deepseek.planner;
  if (providerMode === "fireworks") return LLM_MODEL_CONFIG.fireworks.planner;
  if (providerMode !== "openrouter") return LLM_MODEL_CONFIG.groq.planner;
  return LLM_MODEL_CONFIG.planner;
}

export function ModelsSettingsTab({
  formState,
  models,
  modelsLoading,
  onChange,
}: {
  formState: UserSettings;
  models: ProviderModelOption[];
  modelsLoading: boolean;
  onChange: SettingsChangeHandler;
}) {
  const providerMode = formState.providerMode || "fireworks";
  const hasOpenRouterKey = Boolean(formState.openRouterApiKey);
  const executorModels = getProviderModelOptions({
    providerMode,
    role: "executor",
    openRouterModels: models,
  });
  const plannerModels = getProviderModelOptions({
    providerMode,
    role: "planner",
    openRouterModels: models,
  });
  const openRouterCatalogActive =
    providerMode === "openrouter" || providerMode === "openrouter-groq";

  return (
    <>
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
          API Keys
        </h3>
        <ApiKeyField
          label="OpenRouter"
          value={formState.openRouterApiKey}
          onChange={(value) => onChange("openRouterApiKey", value)}
          placeholder="sk-or-..."
          hint={getKeyUsage("openRouter", providerMode)}
        />
        <ApiKeyField
          label="Fireworks AI"
          value={formState.fireworksApiKey || ""}
          onChange={(value) => onChange("fireworksApiKey", value)}
          placeholder="fw_..."
          hint={getKeyUsage("fireworks", providerMode)}
        />
        <ApiKeyField
          label="DeepSeek"
          value={formState.deepseekApiKey || ""}
          onChange={(value) => onChange("deepseekApiKey", value)}
          placeholder="sk-..."
          hint={getKeyUsage("deepseek", providerMode)}
        />
        <ApiKeyField
          label="Moonshot AI"
          value={formState.kimiApiKey || ""}
          onChange={(value) => onChange("kimiApiKey", value)}
          placeholder="sk-kimi-..."
          hint={getKeyUsage("moonshot", providerMode)}
        />
        <ApiKeyField
          label="Xiaomi MiMo"
          value={formState.xiaomiApiKey || ""}
          onChange={(value) => onChange("xiaomiApiKey", value)}
          placeholder="sk-..."
          hint={getKeyUsage("xiaomi", providerMode)}
        />
        <ApiKeyField
          label="OpenAI"
          value={formState.openaiApiKey || ""}
          onChange={(value) => onChange("openaiApiKey", value)}
          placeholder="sk-..."
          hint={getKeyUsage("openai", providerMode)}
        />
        <ApiKeyField
          label="Groq"
          value={formState.groqApiKey || ""}
          onChange={(value) => onChange("groqApiKey", value)}
          placeholder="gsk_..."
          hint={getKeyUsage("groq", providerMode)}
        />
        <ApiKeyField
          label="Gemini"
          value={formState.geminiApiKey || ""}
          onChange={(value) => onChange("geminiApiKey", value)}
          placeholder="AIza..."
          hint={getKeyUsage("gemini", providerMode)}
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
          Provider Stack
        </h3>
        <select
          value={providerMode}
          onChange={(event) =>
            onChange(
              "providerMode",
              event.target.value as UserSettings["providerMode"],
            )
          }
          className={inputClassName}
        >
          <option value="fireworks">Fireworks AI (Kimi K2.6)</option>
          <option value="fireworks-deepseek">Fireworks + DeepSeek</option>
          <option value="moonshot">Moonshot AI (Kimi 2.6)</option>
          <option value="xiaomi">Xiaomi MiMo</option>
          <option value="openrouter">OpenRouter (GPT-5.4-mini)</option>
          <option value="openrouter-groq">OpenRouter + Groq</option>
          <option value="openai-groq">OpenAI-Compatible + Groq</option>
        </select>
        <p className="text-xs text-warm-400 dark:text-warm-500">
          {getProviderOneLiner(providerMode)}
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
          Model Overrides
        </h3>

        <div className="space-y-1">
          <label className="text-sm font-medium dark:text-warm-300">
            Executor
          </label>
          <p className="text-xs text-warm-400 dark:text-warm-500">
            Multimodal model for screenshots, tool execution, and page
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
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium dark:text-warm-300">
            Planner
          </label>
          <p className="text-xs text-warm-400 dark:text-warm-500">
            Reasoning model for task decomposition and escalation
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
            onChange={(value) => onChange("plannerModel", value || undefined)}
            defaultModel={defaultPlannerModel(providerMode)}
            models={plannerModels}
            loading={providerMode === "openrouter" ? modelsLoading : false}
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
                  option.value === (formState.perceptionMode ?? "auto"),
              )?.description
            }
          </p>
          <p className="text-xs text-warm-500 dark:text-warm-400">
            Vision-only interaction is not exposed yet; visual tasks still keep
            DOM references for safer tool use.
          </p>
          <div className="flex items-center justify-between gap-3 pt-2">
            <div>
              <label className="text-sm font-medium dark:text-warm-300">
                Image budget
              </label>
              <p className="text-xs text-warm-400 dark:text-warm-500">
                Estimated image tokens per session
              </p>
            </div>
            <input
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
                  raw && Number.isFinite(next) && next >= 0 ? next : undefined,
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
                Nitro
              </span>
              <p className="mt-0.5 text-xs text-warm-400 dark:text-warm-500">
                Route through faster :nitro endpoints
              </p>
            </div>
            <button
              role="switch"
              aria-checked={Boolean(formState.useNitro)}
              onClick={() => onChange("useNitro", !formState.useNitro)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                formState.useNitro
                  ? "bg-primary-600"
                  : "bg-warm-300 dark:bg-warm-600"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                  formState.useNitro ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        ) : null}
      </section>
    </>
  );
}

function ApiKeyField({
  hint,
  label,
  onChange,
  placeholder,
  value,
}: {
  hint: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium dark:text-warm-300">{label}</label>
      <input
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClassName}
        placeholder={placeholder}
      />
      <p className={hintClassName}>{hint}</p>
    </div>
  );
}
