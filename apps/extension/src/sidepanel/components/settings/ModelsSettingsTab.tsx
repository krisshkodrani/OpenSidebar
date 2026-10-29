import React from "react";
import {
  ChevronDown,
  KeyRound,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import type { PerceptionRuntimeMode, UserSettings } from "../../../types";
import { DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE } from "../../../types";
import { LLM_MODEL_CONFIG } from "../../../config/model-config";
import { hasProviderCredentials } from "../../../utils/provider-keys";
import type { ProviderModelOption } from "../../hooks/useOpenRouterModels";
import {
  getProviderModelCatalogNote,
  getProviderModelOptions,
} from "../../hooks/useOpenRouterModels";
import { ModelSelector } from "../ModelSelector";
import { PERCEPTION_MODE_OPTIONS } from "./settings-options";
import type { SettingsChangeHandler } from "./types";

const inputClassName =
  "w-full px-3 py-2 text-ui-body border border-line-strong rounded-md bg-canvas focus:ring-2 focus:ring-accent outline-none";
const hintClassName = "mt-0.5 text-ui-caption text-fg-tertiary";

const OPENROUTER_KEY_FIELD = {
  label: "OpenRouter",
  placeholder: "sk-or-...",
  description: "Full agent stack and live model catalog.",
} as const;

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
  const connected = hasProviderCredentials(formState);
  const hasOpenRouterKey = Boolean(formState.openRouterApiKey);
  const executorModels = getProviderModelOptions({
    role: "executor",
    openRouterModels: models,
  });
  const plannerModels = getProviderModelOptions({
    role: "planner",
    openRouterModels: models,
  });
  const writerModels = getProviderModelOptions({
    role: "writer",
    openRouterModels: models,
  });

  return (
    <>
      {showConnections ? (
        <section className="space-y-3">
          <div>
            <h3 className="text-ui-control font-semibold uppercase tracking-wider text-fg-tertiary">
              Connections
            </h3>
            <p className="mt-1 text-ui-control text-fg-tertiary">
              {formState.inferenceMode === "cloud"
                ? "Account connections are managed securely on opensidebar.com. These fields are only for switching to Direct from this browser."
                : "Direct provider keys stay in this browser."}
            </p>
          </div>
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <ApiKeyField
              id="provider-key-openRouterApiKey"
              label={OPENROUTER_KEY_FIELD.label}
              value={formState.openRouterApiKey || ""}
              onChange={(value) => onChange("openRouterApiKey", value)}
              placeholder={OPENROUTER_KEY_FIELD.placeholder}
              description={OPENROUTER_KEY_FIELD.description}
            />
          </div>
        </section>
      ) : null}

      {connectionsOnly ? null : (
        <>
          {connected ? null : (
            <div className="rounded-lg border border-dashed border-line-strong bg-surface-subtle p-4 text-center">
              <KeyRound
                size={20}
                className="mx-auto mb-2 text-fg-tertiary"
                aria-hidden="true"
              />
              <p className="text-ui-body font-medium text-fg-secondary">
                Connect OpenRouter
              </p>
              <p className="mt-1 text-ui-control text-fg-tertiary">
                Sign in and connect OpenRouter, or add your OpenRouter key from
                this browser under Advanced.
              </p>
            </div>
          )}

          {connected ? (
            <section className="space-y-3">
              <div className="rounded-lg border border-success/30 bg-success-subtle p-3">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck
                    size={18}
                    className="mt-0.5 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-ui-body font-semibold text-success">
                      {formState.executorModel || formState.plannerModel
                        ? "Custom model setup active"
                        : "Tested defaults active"}
                    </p>
                    <dl className="mt-2 grid grid-cols-[auto,minmax(0,1fr)] gap-x-3 gap-y-1 text-ui-control">
                      <dt className="text-success">
                        Executor
                      </dt>
                      <dd className="truncate font-mono text-success">
                        {formState.executorModel ||
                          LLM_MODEL_CONFIG.executor}
                      </dd>
                      <dt className="text-success">
                        Planner
                      </dt>
                      <dd className="truncate font-mono text-success">
                        {formState.plannerModel ||
                          LLM_MODEL_CONFIG.planner}
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>

              <details className="group overflow-hidden rounded-lg border border-line bg-surface">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 hover:bg-surface-subtle">
                  <SlidersHorizontal
                    size={17}
                    className="shrink-0 text-fg-tertiary"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-ui-body font-medium text-fg">
                      Advanced model settings
                    </p>
                    <p className="mt-0.5 text-ui-caption text-fg-tertiary">
                      Override models, observation, or routing.
                    </p>
                  </div>
                  <ChevronDown
                    size={15}
                    aria-hidden="true"
                    className="shrink-0 text-fg-tertiary transition-transform group-open:rotate-180"
                  />
                </summary>

                <div className="space-y-5 border-t border-line p-3">
                  {modelsError ? (
                    <p className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-ui-control text-danger">
                      OpenRouter model catalog unavailable: {modelsError}.
                      Tested defaults remain usable.
                    </p>
                  ) : null}

                  <div className="space-y-1">
                    <label className="text-ui-body font-medium">
                      Executor
                    </label>
                    <p className="text-ui-control text-fg-tertiary">
                      Screenshot understanding, tool execution, and page
                      interaction
                    </p>
                    <p className="text-ui-control text-fg-tertiary">
                      {getProviderModelCatalogNote({
                        role: "executor",
                        hasOpenRouterKey,
                      })}
                    </p>
                    <ModelSelector
                      value={formState.executorModel || ""}
                      onChange={(value) =>
                        onChange("executorModel", value || undefined)
                      }
                      defaultModel={LLM_MODEL_CONFIG.executor}
                      models={executorModels}
                      loading={modelsLoading}
                      filterVisionOnly
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-ui-body font-medium">
                      Planner
                    </label>
                    <p className="text-ui-control text-fg-tertiary">
                      Task decomposition and escalation
                    </p>
                    <p className="text-ui-control text-fg-tertiary">
                      {getProviderModelCatalogNote({
                        role: "planner",
                        hasOpenRouterKey,
                      })}
                    </p>
                    <ModelSelector
                      value={formState.plannerModel || ""}
                      onChange={(value) =>
                        onChange("plannerModel", value || undefined)
                      }
                      defaultModel={LLM_MODEL_CONFIG.planner}
                      models={plannerModels}
                      loading={modelsLoading}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-ui-body font-medium">
                      Writer{" "}
                      <span className="font-normal text-fg-tertiary">
                        (optional)
                      </span>
                    </label>
                    <p className="text-ui-control text-fg-tertiary">
                      Dedicated prose model; leave empty to reuse the executor.
                    </p>
                    <ModelSelector
                      value={formState.writerModel || ""}
                      onChange={(value) =>
                        onChange("writerModel", value || undefined)
                      }
                      defaultModel={LLM_MODEL_CONFIG.executor}
                      models={writerModels}
                      loading={modelsLoading}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-ui-body font-medium">
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
                    <p className="text-ui-control text-fg-tertiary">
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
                          className="text-ui-body font-medium"
                        >
                          Image budget
                        </label>
                        <p className="text-ui-control text-fg-tertiary">
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

                  <div className="flex items-center justify-between py-1">
                      <div>
                        <span className="text-ui-body font-medium">
                          Nitro routing
                        </span>
                        <p className="mt-0.5 text-ui-control text-fg-tertiary">
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
                            ? "bg-accent"
                            : "bg-line-strong"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-surface shadow-sm transition-transform ${
                            formState.useNitro
                              ? "translate-x-4"
                              : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>
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
    <details className="group border-b border-line last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 hover:bg-surface-subtle">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-ui-body font-medium text-fg">
              {label}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-ui-caption font-medium uppercase tracking-wide ${
                connected
                  ? "bg-success-subtle text-success"
                  : "bg-surface-subtle text-fg-tertiary"
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
          className="shrink-0 text-fg-tertiary transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-line bg-canvas px-3 py-3">
        <label
          htmlFor={id}
          className="mb-1.5 block text-ui-control font-medium text-fg-secondary"
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
        <p className="mt-1.5 text-ui-caption text-fg-tertiary">
          Stored locally in this browser. Clear the field to disconnect.
        </p>
      </div>
    </details>
  );
}
