import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, relative, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER,
  getExecutorEligibleModelIds,
} from "../apps/extension/src/utils/executor-model-policy";

export type StableProvider = "openrouter" | "fireworks";

interface OpenRouterCatalogModel {
  id?: string;
  name?: string;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: string[];
  context_length?: number;
  expiration_date?: string | null;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
  };
}

interface FireworksDeprecationDate {
  year?: number;
  month?: number;
  day?: number;
}

interface FireworksCatalogModel {
  name?: string;
  displayName?: string;
  state?: string;
  contextLength?: number;
  supportsImageInput?: boolean;
  supportsTools?: boolean;
  supportsServerless?: boolean;
  deprecationDate?: FireworksDeprecationDate | null;
}

export interface ModelCompatibilityRow {
  id: string;
  name: string;
  allowlisted: boolean;
  catalogListed: boolean;
  inferenceListed?: boolean;
  supportsImage: boolean;
  supportsTools: boolean;
  supportsToolChoice?: boolean;
  supportsStructuredOutputs?: boolean;
  supportsServerless?: boolean;
  contextLength?: number;
  expirationDate?: string | null;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  candidate: boolean;
}

export interface ProviderCompatibilityReport {
  provider: StableProvider;
  catalogModelCount: number;
  executorCandidateCount: number;
  allowlist: ModelCompatibilityRow[];
  additionalCandidates: ModelCompatibilityRow[];
}

export interface ProbeResult {
  provider: StableProvider;
  model: string;
  ok: boolean;
  status: number;
  actualModel?: string;
  toolCallObserved: boolean;
  finishReason?: string;
  responseSummary?: string;
  error?: string;
}

export interface ModelCompatibilityReport {
  generatedAt: string;
  providers: ProviderCompatibilityReport[];
  probes: ProbeResult[];
}

export interface ModelCheckOptions {
  providers: StableProvider[];
  probe: boolean;
  model?: string;
  outputPath?: string;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const OPENROUTER_MODELS_URL =
  "https://openrouter.ai/api/v1/models?input_modalities=image&output_modalities=text&supported_parameters=tools";
const FIREWORKS_MODELS_URL =
  "https://api.fireworks.ai/v1/accounts/fireworks/models?filter=supports_serverless%3Dtrue&pageSize=200";
const FIREWORKS_INFERENCE_MODELS_URL =
  "https://api.fireworks.ai/inference/v1/models";
const PROBE_IMAGE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAKUlEQVR4nO3OIQEAAAACIP+f1hkWWEB6FgEBAQEBAQEBAQEBAQEBgXdgl/rw4unIZ5cAAAAASUVORK5CYII=";

function numericPrice(value: string | number | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed * 1_000_000 : undefined;
}

function hasFutureExpiration(
  expirationDate: string | null | undefined,
  now: Date,
): boolean {
  if (!expirationDate) return true;
  const expiration = new Date(`${expirationDate}T23:59:59.999Z`);
  return Number.isFinite(expiration.getTime()) && expiration >= now;
}

function fireworksExpiration(
  value: FireworksDeprecationDate | null | undefined,
): string | null {
  if (!value?.year || !value.month || !value.day) return null;
  return [
    String(value.year).padStart(4, "0"),
    String(value.month).padStart(2, "0"),
    String(value.day).padStart(2, "0"),
  ].join("-");
}

export function buildOpenRouterReport(
  models: OpenRouterCatalogModel[],
  now = new Date(),
): ProviderCompatibilityReport {
  const allowlisted = new Set(getExecutorEligibleModelIds("openrouter"));
  const rows = models
    .filter(
      (model): model is OpenRouterCatalogModel & { id: string } =>
        typeof model.id === "string" && model.id.trim().length > 0,
    )
    .map<ModelCompatibilityRow>((model) => {
      const parameters = new Set(model.supported_parameters ?? []);
      const supportsImage =
        model.architecture?.input_modalities?.includes("image") ?? false;
      const supportsTextOutput =
        model.architecture?.output_modalities?.includes("text") ?? false;
      const supportsTools = parameters.has("tools");
      const supportsToolChoice = parameters.has("tool_choice");
      const expirationDate = model.expiration_date ?? null;
      return {
        id: model.id,
        name: model.name?.trim() || model.id,
        allowlisted: allowlisted.has(model.id),
        catalogListed: true,
        supportsImage,
        supportsTools,
        supportsToolChoice,
        supportsStructuredOutputs: parameters.has("structured_outputs"),
        contextLength: model.context_length,
        expirationDate,
        inputUsdPerMillion: numericPrice(model.pricing?.prompt),
        outputUsdPerMillion: numericPrice(model.pricing?.completion),
        candidate:
          supportsImage &&
          supportsTextOutput &&
          supportsTools &&
          supportsToolChoice &&
          hasFutureExpiration(expirationDate, now),
      };
    });

  const byId = new Map(rows.map((row) => [row.id, row]));
  const missingRows = [...allowlisted]
    .filter((id) => !byId.has(id))
    .map<ModelCompatibilityRow>((id) => ({
      id,
      name: id,
      allowlisted: true,
      catalogListed: false,
      supportsImage: false,
      supportsTools: false,
      supportsToolChoice: false,
      supportsStructuredOutputs: false,
      candidate: false,
    }));
  const allRows = [...rows, ...missingRows];

  return {
    provider: "openrouter",
    catalogModelCount: rows.length,
    executorCandidateCount: rows.filter((row) => row.candidate).length,
    allowlist: allRows
      .filter((row) => row.allowlisted)
      .sort((a, b) => a.id.localeCompare(b.id)),
    additionalCandidates: rows
      .filter((row) => row.candidate && !row.allowlisted)
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function buildFireworksReport(
  models: FireworksCatalogModel[],
  inferenceModelIds: string[],
  now = new Date(),
): ProviderCompatibilityReport {
  const allowlisted = new Set(getExecutorEligibleModelIds("fireworks"));
  const inferenceIds = new Set(inferenceModelIds);
  const rows = models
    .filter(
      (model): model is FireworksCatalogModel & { name: string } =>
        typeof model.name === "string" && model.name.trim().length > 0,
    )
    .map<ModelCompatibilityRow>((model) => {
      const expirationDate = fireworksExpiration(model.deprecationDate);
      const supportsImage = model.supportsImageInput === true;
      const supportsTools = model.supportsTools === true;
      const supportsServerless = model.supportsServerless === true;
      return {
        id: model.name,
        name: model.displayName?.trim() || model.name,
        allowlisted: allowlisted.has(model.name),
        catalogListed: true,
        inferenceListed: inferenceIds.has(model.name),
        supportsImage,
        supportsTools,
        supportsServerless,
        contextLength: model.contextLength,
        expirationDate,
        candidate:
          model.state === "READY" &&
          supportsImage &&
          supportsTools &&
          supportsServerless &&
          hasFutureExpiration(expirationDate, now),
      };
    });

  const byId = new Map(rows.map((row) => [row.id, row]));
  const missingRows = [...allowlisted]
    .filter((id) => !byId.has(id))
    .map<ModelCompatibilityRow>((id) => ({
      id,
      name: id,
      allowlisted: true,
      catalogListed: false,
      inferenceListed: inferenceIds.has(id),
      supportsImage: false,
      supportsTools: false,
      supportsServerless: false,
      candidate: false,
    }));
  const allRows = [...rows, ...missingRows];

  return {
    provider: "fireworks",
    catalogModelCount: rows.length,
    executorCandidateCount: rows.filter((row) => row.candidate).length,
    allowlist: allRows
      .filter((row) => row.allowlisted)
      .sort((a, b) => a.id.localeCompare(b.id)),
    additionalCandidates: rows
      .filter((row) => row.candidate && !row.allowlisted)
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

export async function fetchOpenRouterReport(
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderCompatibilityReport> {
  const response = await fetchImpl(OPENROUTER_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const json = (await readJson(response)) as {
    data?: OpenRouterCatalogModel[];
  };
  return buildOpenRouterReport(Array.isArray(json.data) ? json.data : []);
}

export async function fetchFireworksReport(
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderCompatibilityReport> {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const [catalogResponse, inferenceResponse] = await Promise.all([
    fetchImpl(FIREWORKS_MODELS_URL, { headers }),
    fetchImpl(FIREWORKS_INFERENCE_MODELS_URL, { headers }),
  ]);
  const catalog = (await readJson(catalogResponse)) as {
    models?: FireworksCatalogModel[];
  };
  const inference = (await readJson(inferenceResponse)) as {
    data?: Array<{ id?: string }>;
  };
  const inferenceIds = (inference.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => typeof id === "string");
  return buildFireworksReport(
    Array.isArray(catalog.models) ? catalog.models : [],
    inferenceIds,
  );
}

export async function probeModel(
  provider: StableProvider,
  model: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<ProbeResult> {
  const toolName = "report_compatibility";
  const response = await fetchImpl(
    provider === "openrouter"
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.fireworks.ai/inference/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Call report_compatibility with ok=true after inspecting the image.",
              },
              { type: "image_url", image_url: { url: PROBE_IMAGE_PNG } },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: toolName,
              description: "Report that the compatibility probe completed.",
              parameters: {
                type: "object",
                properties: { ok: { type: "boolean" } },
                required: ["ok"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: toolName } },
        temperature: 0,
        max_tokens: 512,
      }),
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    return {
      provider,
      model,
      ok: false,
      status: response.status,
      toolCallObserved: false,
      error: raw.slice(0, 300),
    };
  }

  const json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const choice =
    choices[0] && typeof choices[0] === "object"
      ? (choices[0] as {
          finish_reason?: unknown;
          message?: {
            content?: unknown;
            reasoning_content?: unknown;
            tool_calls?: unknown[];
          };
        })
      : undefined;
  const message = choice?.message;
  const toolCallObserved = Array.isArray(message?.tool_calls)
    ? message.tool_calls.some((call) => {
        if (!call || typeof call !== "object") return false;
        const fn = (call as { function?: { name?: string } }).function;
        return fn?.name === toolName;
      })
    : false;

  return {
    provider,
    model,
    ok: toolCallObserved,
    status: response.status,
    actualModel: typeof json.model === "string" ? json.model : undefined,
    toolCallObserved,
    finishReason:
      typeof choice?.finish_reason === "string"
        ? choice.finish_reason
        : undefined,
    responseSummary: summarizeProbeMessage(message),
    ...(!toolCallObserved
      ? {
          error:
            "Response succeeded but did not contain the required tool call.",
        }
      : {}),
  };
}

function summarizeProbeMessage(
  message:
    | {
        content?: unknown;
        reasoning_content?: unknown;
        tool_calls?: unknown[];
      }
    | undefined,
): string | undefined {
  if (!message) return undefined;
  const parts: string[] = [];
  if (typeof message.content === "string" && message.content.trim()) {
    parts.push(`content=${JSON.stringify(message.content.slice(0, 160))}`);
  }
  if (
    typeof message.reasoning_content === "string" &&
    message.reasoning_content.trim()
  ) {
    parts.push(
      `reasoning=${JSON.stringify(message.reasoning_content.slice(0, 160))}`,
    );
  }
  if (Array.isArray(message.tool_calls)) {
    parts.push(`tool_calls=${message.tool_calls.length}`);
  }
  return parts.join("; ") || "empty assistant message";
}

export function parseModelCheckArgs(argv: string[]): ModelCheckOptions {
  const providerArg = argv.find((arg) => arg.startsWith("--provider="));
  const providerValue = providerArg?.slice("--provider=".length) ?? "all";
  if (!["all", "openrouter", "fireworks"].includes(providerValue)) {
    throw new Error(`Unsupported provider "${providerValue}".`);
  }
  const model = argv
    .find((arg) => arg.startsWith("--model="))
    ?.slice("--model=".length)
    .trim();
  if (model && providerValue === "all") {
    throw new Error("--model requires --provider=openrouter or fireworks.");
  }
  return {
    providers:
      providerValue === "all"
        ? ["openrouter", "fireworks"]
        : [providerValue as StableProvider],
    probe: argv.includes("--probe"),
    ...(model ? { model } : {}),
    outputPath: argv
      .find((arg) => arg.startsWith("--output="))
      ?.slice("--output=".length),
  };
}

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf-8")
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [match[1], match[2].trim().replace(/^["']|["']$/g, "")]),
  );
}

function providerKey(
  provider: StableProvider,
  fileValues: Record<string, string>,
): string | undefined {
  const name =
    provider === "openrouter" ? "OPENROUTER_API_KEY" : "FIREWORKS_API_KEY";
  return process.env[name]?.trim() || fileValues[name]?.trim() || undefined;
}

function printProviderReport(report: ProviderCompatibilityReport): void {
  console.log(
    `\n${report.provider}: ${report.catalogModelCount} catalog models, ${report.executorCandidateCount} executor-compatible candidates`,
  );
  console.table(
    report.allowlist.map((row) => ({
      model: row.id,
      listed: row.catalogListed,
      image: row.supportsImage,
      tools: row.supportsTools,
      candidate: row.candidate,
      ...(row.inferenceListed === undefined
        ? {}
        : { inferenceList: row.inferenceListed }),
    })),
  );
  console.log(
    `Additional compatible candidates: ${report.additionalCandidates.length}`,
  );
}

async function main(): Promise<void> {
  const options = parseModelCheckArgs(process.argv.slice(2));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const fileValues = readEnvFile(resolve(repoRoot, ".env"));
  const providers: ProviderCompatibilityReport[] = [];
  const probes: ProbeResult[] = [];

  for (const provider of options.providers) {
    const apiKey = providerKey(provider, fileValues);
    if (!apiKey) {
      throw new Error(
        `${provider === "openrouter" ? "OPENROUTER_API_KEY" : "FIREWORKS_API_KEY"} is not configured.`,
      );
    }
    const report =
      provider === "openrouter"
        ? await fetchOpenRouterReport(apiKey)
        : await fetchFireworksReport(apiKey);
    providers.push(report);
    printProviderReport(report);

    if (options.probe) {
      const model =
        options.model ?? DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER[provider];
      const result = await probeModel(provider, model, apiKey);
      probes.push(result);
      console.log(
        `Probe ${provider}/${model}: ${result.ok ? "PASS" : "FAIL"} (HTTP ${result.status})`,
      );
    }
  }

  const report: ModelCompatibilityReport = {
    generatedAt: new Date().toISOString(),
    providers,
    probes,
  };
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const outputPath = resolve(
    repoRoot,
    options.outputPath ?? `.artifacts/models/model-compatibility-${stamp}.json`,
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  console.log(`\nReport: ${relative(repoRoot, outputPath)}`);

  const incompatibleAllowlist = providers.flatMap((provider) =>
    provider.allowlist.filter((model) => !model.candidate),
  );
  const failedProbes = probes.filter((probe) => !probe.ok);
  if (incompatibleAllowlist.length > 0 || failedProbes.length > 0) {
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === entryPoint) {
  main().catch((error) => {
    console.error(
      `[models:check] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
