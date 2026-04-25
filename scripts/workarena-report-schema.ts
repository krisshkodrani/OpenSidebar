export type ValidationError = {
  path: string;
  message: string;
};

const CHECK_STATUSES = ["ok", "missing", "blocked", "pending"] as const;
const READINESS_STATUSES = ["ready", "local_ready_hf_pending", "blocked"] as const;
const TASK_KINDS = ["atomic", "compositional"] as const;
const SUITES = ["all", "atomic", "l1", "l2", "l3"] as const;
const PHASE_STATUSES = ["ready", "pending", "blocked"] as const;
const RESET_STATUSES = [
  "blocked_requires_reset_flag",
  "blocked_setup",
  "reset_succeeded",
  "reset_failed",
] as const;
const EXECUTION_STATUSES = ["pending", "passed", "failed", "error"] as const;
const FAILURE_STAGES = [
  "setup",
  "reset",
  "extension_launch",
  "agent_run",
  "validation",
  "teardown",
] as const;
const PROMPT_SOURCES = ["workarena_goal_after_reset", "local_fixture_prompt"] as const;
const BROWSER_ATTACH_STRATEGIES = [
  "extension-loaded-browser-context",
  "separate-extension-browser-with-transferred-session",
] as const;
const HELD_SESSION_COMMANDS = [
  "describe",
  "reset",
  "export_session",
  "validate",
  "teardown",
] as const;
const HELD_SESSION_STATUSES = [
  "protocol_ready",
  "blocked_requires_reset_flag",
  "blocked_setup",
  "reset_succeeded",
  "reset_failed",
] as const;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function push(errors: ValidationError[], path: string, message: string): void {
  errors.push({ path, message });
}

function requireRecord(
  value: unknown,
  path: string,
  errors: ValidationError[],
): JsonRecord | null {
  if (isRecord(value)) return value;
  push(errors, path, "expected object");
  return null;
}

function requireArray(
  value: unknown,
  path: string,
  errors: ValidationError[],
): unknown[] | null {
  if (Array.isArray(value)) return value;
  push(errors, path, "expected array");
  return null;
}

function requireString(
  record: JsonRecord,
  key: string,
  path: string,
  errors: ValidationError[],
): void {
  if (typeof record[key] !== "string") {
    push(errors, `${path}.${key}`, "expected string");
  }
}

function requireBoolean(
  record: JsonRecord,
  key: string,
  path: string,
  errors: ValidationError[],
): void {
  if (typeof record[key] !== "boolean") {
    push(errors, `${path}.${key}`, "expected boolean");
  }
}

function requireNumber(
  record: JsonRecord,
  key: string,
  path: string,
  errors: ValidationError[],
): void {
  if (typeof record[key] !== "number" || !Number.isFinite(record[key])) {
    push(errors, `${path}.${key}`, "expected finite number");
  }
}

function requireNullableString(
  record: JsonRecord,
  key: string,
  path: string,
  errors: ValidationError[],
): void {
  if (record[key] !== null && typeof record[key] !== "string") {
    push(errors, `${path}.${key}`, "expected string or null");
  }
}

function requireNullableNumber(
  record: JsonRecord,
  key: string,
  path: string,
  errors: ValidationError[],
): void {
  if (
    record[key] !== null &&
    (typeof record[key] !== "number" || !Number.isFinite(record[key]))
  ) {
    push(errors, `${path}.${key}`, "expected finite number or null");
  }
}

function requireNullableBoolean(
  record: JsonRecord,
  key: string,
  path: string,
  errors: ValidationError[],
): void {
  if (record[key] !== null && typeof record[key] !== "boolean") {
    push(errors, `${path}.${key}`, "expected boolean or null");
  }
}

function requireOneOf(
  record: JsonRecord,
  key: string,
  values: readonly string[],
  path: string,
  errors: ValidationError[],
): void {
  if (typeof record[key] !== "string" || !values.includes(record[key])) {
    push(errors, `${path}.${key}`, `expected one of: ${values.join(", ")}`);
  }
}

function requireStringArray(
  record: JsonRecord,
  key: string,
  path: string,
  errors: ValidationError[],
): void {
  const array = requireArray(record[key], `${path}.${key}`, errors);
  if (!array) return;
  array.forEach((value, index) => {
    if (typeof value !== "string") {
      push(errors, `${path}.${key}[${index}]`, "expected string");
    }
  });
}

function validateChecks(value: unknown, path: string, errors: ValidationError[]): void {
  const checks = requireArray(value, path, errors);
  if (!checks) return;
  checks.forEach((check, index) => {
    const checkRecord = requireRecord(check, `${path}[${index}]`, errors);
    if (!checkRecord) return;
    requireString(checkRecord, "name", `${path}[${index}]`, errors);
    requireOneOf(checkRecord, "status", CHECK_STATUSES, `${path}[${index}]`, errors);
    requireString(checkRecord, "detail", `${path}[${index}]`, errors);
  });
}

function validateTaskInfo(value: unknown, path: string, errors: ValidationError[]): void {
  const task = requireRecord(value, path, errors);
  if (!task) return;
  requireString(task, "id", path, errors);
  requireNullableString(task, "category", path, errors);
  requireOneOf(task, "kind", TASK_KINDS, path, errors);
  requireNullableString(task, "level", path, errors);
  if (task.seed !== null && typeof task.seed !== "number") {
    push(errors, `${path}.seed`, "expected number or null");
  }
  requireString(task, "className", path, errors);
}

function validateExecutionTask(value: unknown, path: string, errors: ValidationError[]): void {
  const task = requireRecord(value, path, errors);
  if (!task) return;
  requireString(task, "taskId", path, errors);
  requireString(task, "envId", path, errors);
  requireNumber(task, "seed", path, errors);
  requireNullableString(task, "category", path, errors);
  requireOneOf(task, "kind", TASK_KINDS, path, errors);
  requireNullableString(task, "level", path, errors);
  requireString(task, "className", path, errors);
}

function validateDoctor(value: JsonRecord, path: string, errors: ValidationError[]): void {
  requireOneOf(value, "benchmark", ["workarena"], path, errors);
  requireBoolean(value, "ready", path, errors);
  if (value.readiness !== undefined) {
    requireOneOf(value, "readiness", READINESS_STATUSES, path, errors);
  }
  requireString(value, "dataset", path, errors);
  requireString(value, "pythonExecutable", path, errors);
  requireString(value, "platform", path, errors);
  validateChecks(value.checks, `${path}.checks`, errors);
}

function validateList(value: JsonRecord, path: string, errors: ValidationError[]): void {
  requireOneOf(value, "benchmark", ["workarena"], path, errors);
  requireOneOf(value, "suite", SUITES, path, errors);
  requireNumber(value, "count", path, errors);
  const categories = requireArray(value.categories, `${path}.categories`, errors);
  categories?.forEach((category, index) => {
    const record = requireRecord(category, `${path}.categories[${index}]`, errors);
    if (!record) return;
    requireString(record, "category", `${path}.categories[${index}]`, errors);
    requireNumber(record, "count", `${path}.categories[${index}]`, errors);
  });
  const tasks = requireArray(value.tasks, `${path}.tasks`, errors);
  tasks?.forEach((task, index) => {
    validateTaskInfo(task, `${path}.tasks[${index}]`, errors);
  });
}

function validateDry(value: JsonRecord, path: string, errors: ValidationError[]): void {
  requireOneOf(value, "benchmark", ["workarena"], path, errors);
  requireOneOf(value, "mode", ["dry"], path, errors);
  requireString(value, "taskId", path, errors);
  requireString(value, "envId", path, errors);
  requireNumber(value, "seed", path, errors);
  requireNullableString(value, "category", path, errors);
  requireOneOf(value, "kind", TASK_KINDS, path, errors);
  requireNullableString(value, "level", path, errors);
  requireString(value, "className", path, errors);
  requireBoolean(value, "resetAttempted", path, errors);
  requireBoolean(value, "resetSucceeded", path, errors);
  requireNullableBoolean(value, "teardownSucceeded", path, errors);
  requireNumber(value, "durationMs", path, errors);
  requireNullableString(value, "goal", path, errors);
  requireArray(value.goalObject, `${path}.goalObject`, errors);
  requireNullableString(value, "startUrl", path, errors);
  requireNullableString(value, "activeUrl", path, errors);
  requireStringArray(value, "openPages", path, errors);
  requireStringArray(value, "openPageTitles", path, errors);
  requireRecord(value.taskInfo, `${path}.taskInfo`, errors);
  requireNullableString(value, "error", path, errors);
  requireStringArray(value, "notes", path, errors);
}

function validateAdapterPlan(value: JsonRecord, path: string, errors: ValidationError[]): void {
  requireOneOf(value, "benchmark", ["workarena"], path, errors);
  requireOneOf(value, "mode", ["adapter-plan"], path, errors);
  requireBoolean(value, "ready", path, errors);
  requireOneOf(value, "readiness", READINESS_STATUSES, path, errors);
  validateExecutionTask(value.task, `${path}.task`, errors);

  const prompt = requireRecord(value.prompt, `${path}.prompt`, errors);
  if (prompt) {
    requireBoolean(prompt, "available", `${path}.prompt`, errors);
    requireOneOf(prompt, "source", ["workarena_goal_after_reset"], `${path}.prompt`, errors);
    requireNullableString(prompt, "value", `${path}.prompt`, errors);
    requireString(prompt, "note", `${path}.prompt`, errors);
  }

  const browser = requireRecord(value.browser, `${path}.browser`, errors);
  if (browser) {
    requireOneOf(browser, "source", ["browsergym"], `${path}.browser`, errors);
    requireBoolean(browser, "resetRequired", `${path}.browser`, errors);
    requireOneOf(
      browser,
      "attachStrategy",
      BROWSER_ATTACH_STRATEGIES,
      `${path}.browser`,
      errors,
    );
    requireNullableString(browser, "startUrl", `${path}.browser`, errors);
    requireNullableString(browser, "activeUrl", `${path}.browser`, errors);
  }

  const runner = requireRecord(value.runner, `${path}.runner`, errors);
  const phases = runner
    ? requireArray(runner.phases, `${path}.runner.phases`, errors)
    : null;
  phases?.forEach((item, index) => {
    const phase = requireRecord(item, `${path}.runner.phases[${index}]`, errors);
    if (!phase) return;
    requireString(phase, "name", `${path}.runner.phases[${index}]`, errors);
    requireOneOf(
      phase,
      "status",
      PHASE_STATUSES,
      `${path}.runner.phases[${index}]`,
      errors,
    );
    requireString(phase, "detail", `${path}.runner.phases[${index}]`, errors);
  });
  requireStringArray(value, "safety", path, errors);
  requireRecord(value.reports, `${path}.reports`, errors);
}

function validateResetRun(value: JsonRecord, path: string, errors: ValidationError[]): void {
  requireOneOf(value, "benchmark", ["workarena"], path, errors);
  requireOneOf(value, "mode", ["guarded-reset"], path, errors);
  requireBoolean(value, "ready", path, errors);
  requireOneOf(value, "status", RESET_STATUSES, path, errors);
  requireOneOf(value, "readiness", READINESS_STATUSES, path, errors);

  const task = requireRecord(value.task, `${path}.task`, errors);
  if (task) {
    requireString(task, "taskId", `${path}.task`, errors);
    requireNumber(task, "seed", `${path}.task`, errors);
  }

  const doctor = requireRecord(value.doctor, `${path}.doctor`, errors);
  if (doctor) {
    requireBoolean(doctor, "ready", `${path}.doctor`, errors);
    requireOneOf(doctor, "readiness", READINESS_STATUSES, `${path}.doctor`, errors);
    requireString(doctor, "pythonExecutable", `${path}.doctor`, errors);
    requireString(doctor, "dataset", `${path}.doctor`, errors);
    validateChecks(doctor.checks, `${path}.doctor.checks`, errors);
  }

  if (value.reset !== null) {
    const reset = requireRecord(value.reset, `${path}.reset`, errors);
    if (reset) validateDry(reset, `${path}.reset`, errors);
  }

  const next = requireRecord(value.next, `${path}.next`, errors);
  if (next) {
    requireBoolean(next, "canExecuteAgent", `${path}.next`, errors);
    requireString(next, "reason", `${path}.next`, errors);
  }
  requireStringArray(value, "safety", path, errors);
}

function validateExecution(value: JsonRecord, path: string, errors: ValidationError[]): void {
  requireOneOf(value, "benchmark", ["workarena"], path, errors);
  requireOneOf(value, "mode", ["agent-execution"], path, errors);
  requireBoolean(value, "ready", path, errors);
  requireOneOf(value, "status", EXECUTION_STATUSES, path, errors);
  if (value.failureStage !== null) {
    requireOneOf(value, "failureStage", FAILURE_STAGES, path, errors);
  }
  validateExecutionTask(value.task, `${path}.task`, errors);

  const prompt = requireRecord(value.prompt, `${path}.prompt`, errors);
  if (prompt) {
    requireOneOf(prompt, "source", PROMPT_SOURCES, `${path}.prompt`, errors);
    requireString(prompt, "value", `${path}.prompt`, errors);
    requireArray(prompt.goalObject, `${path}.prompt.goalObject`, errors);
  }

  const browser = requireRecord(value.browser, `${path}.browser`, errors);
  if (browser) {
    requireNullableString(browser, "startUrl", `${path}.browser`, errors);
    requireNullableString(browser, "activeUrl", `${path}.browser`, errors);
    requireStringArray(browser, "openPages", `${path}.browser`, errors);
    requireStringArray(browser, "openPageTitles", `${path}.browser`, errors);
  }

  const agent = requireRecord(value.agent, `${path}.agent`, errors);
  if (agent) {
    requireString(agent, "provider", `${path}.agent`, errors);
    requireNullableString(agent, "executorModel", `${path}.agent`, errors);
    requireNullableString(agent, "plannerModel", `${path}.agent`, errors);
    requireStringArray(agent, "traceIds", `${path}.agent`, errors);
    requireStringArray(agent, "traceFiles", `${path}.agent`, errors);
    requireNullableString(agent, "finalAnswer", `${path}.agent`, errors);
    requireNullableNumber(agent, "turns", `${path}.agent`, errors);
    requireNullableNumber(agent, "perceptions", `${path}.agent`, errors);
    requireNullableNumber(agent, "toolCalls", `${path}.agent`, errors);
    requireNullableNumber(agent, "toolExecutions", `${path}.agent`, errors);
    requireNullableNumber(agent, "costUsd", `${path}.agent`, errors);
    const tokens = requireRecord(agent.tokens, `${path}.agent.tokens`, errors);
    if (tokens) {
      requireNullableNumber(tokens, "input", `${path}.agent.tokens`, errors);
      requireNullableNumber(tokens, "output", `${path}.agent.tokens`, errors);
      requireNullableNumber(tokens, "total", `${path}.agent.tokens`, errors);
    }
  }

  const validation = requireRecord(value.validation, `${path}.validation`, errors);
  if (validation) {
    requireNullableBoolean(validation, "passed", `${path}.validation`, errors);
    requireNullableNumber(validation, "score", `${path}.validation`, errors);
    requireNullableString(validation, "message", `${path}.validation`, errors);
    requireRecord(validation.details, `${path}.validation.details`, errors);
  }

  const timings = requireRecord(value.timings, `${path}.timings`, errors);
  if (timings) {
    requireNullableNumber(timings, "resetMs", `${path}.timings`, errors);
    requireNullableNumber(timings, "agentMs", `${path}.timings`, errors);
    requireNullableNumber(timings, "validationMs", `${path}.timings`, errors);
    requireNullableNumber(timings, "totalMs", `${path}.timings`, errors);
  }

  const errorItems = requireArray(value.errors, `${path}.errors`, errors);
  errorItems?.forEach((item, index) => {
    const error = requireRecord(item, `${path}.errors[${index}]`, errors);
    if (!error) return;
    requireOneOf(error, "stage", FAILURE_STAGES, `${path}.errors[${index}]`, errors);
    requireString(error, "message", `${path}.errors[${index}]`, errors);
  });
  requireRecord(value.reports, `${path}.reports`, errors);
}

function validateBrowserStrategy(
  value: JsonRecord,
  path: string,
  errors: ValidationError[],
): void {
  requireOneOf(value, "benchmark", ["workarena"], path, errors);
  requireOneOf(value, "mode", ["browser-strategy"], path, errors);
  requireBoolean(value, "ready", path, errors);
  requireOneOf(
    value,
    "recommendedStrategy",
    BROWSER_ATTACH_STRATEGIES,
    path,
    errors,
  );

  const facts = requireRecord(value.facts, `${path}.facts`, errors);
  if (facts) {
    const browsergym = requireRecord(facts.browsergym, `${path}.facts.browsergym`, errors);
    if (browsergym) {
      requireString(browsergym, "envFile", `${path}.facts.browsergym`, errors);
      requireString(
        browsergym,
        "browserEnvInitSignature",
        `${path}.facts.browsergym`,
        errors,
      );
      requireBoolean(browsergym, "usesChromiumLaunch", `${path}.facts.browsergym`, errors);
      requireBoolean(browsergym, "usesNewContext", `${path}.facts.browsergym`, errors);
      requireBoolean(
        browsergym,
        "usesLaunchPersistentContext",
        `${path}.facts.browsergym`,
        errors,
      );
      requireBoolean(
        browsergym,
        "supportsPwChromiumKwargs",
        `${path}.facts.browsergym`,
        errors,
      );
      requireBoolean(
        browsergym,
        "supportsPwContextKwargs",
        `${path}.facts.browsergym`,
        errors,
      );
    }

    const opensidebar = requireRecord(
      facts.opensidebar,
      `${path}.facts.opensidebar`,
      errors,
    );
    if (opensidebar) {
      requireString(opensidebar, "harnessFile", `${path}.facts.opensidebar`, errors);
      requireBoolean(opensidebar, "usesPuppeteer", `${path}.facts.opensidebar`, errors);
      requireBoolean(
        opensidebar,
        "usesLoadExtensionFlag",
        `${path}.facts.opensidebar`,
        errors,
      );
      requireBoolean(
        opensidebar,
        "usesDisableExtensionsExceptFlag",
        `${path}.facts.opensidebar`,
        errors,
      );
      requireBoolean(
        opensidebar,
        "usesPipeTransport",
        `${path}.facts.opensidebar`,
        errors,
      );
      requireString(opensidebar, "distPath", `${path}.facts.opensidebar`, errors);
      requireBoolean(opensidebar, "distExists", `${path}.facts.opensidebar`, errors);
    }
  }

  const candidates = requireArray(value.candidates, `${path}.candidates`, errors);
  candidates?.forEach((item, index) => {
    const candidate = requireRecord(item, `${path}.candidates[${index}]`, errors);
    if (!candidate) return;
    requireOneOf(
      candidate,
      "id",
      BROWSER_ATTACH_STRATEGIES,
      `${path}.candidates[${index}]`,
      errors,
    );
    requireOneOf(
      candidate,
      "verdict",
      ["recommended", "not_recommended"],
      `${path}.candidates[${index}]`,
      errors,
    );
    requireString(candidate, "rationale", `${path}.candidates[${index}]`, errors);
    requireStringArray(candidate, "evidence", `${path}.candidates[${index}]`, errors);
    requireStringArray(candidate, "risks", `${path}.candidates[${index}]`, errors);
    requireStringArray(candidate, "nextSteps", `${path}.candidates[${index}]`, errors);
  });

  const decision = requireRecord(value.decision, `${path}.decision`, errors);
  if (decision) {
    requireString(decision, "summary", `${path}.decision`, errors);
    requireStringArray(decision, "implementationPlan", `${path}.decision`, errors);
  }
  requireStringArray(value, "safety", path, errors);
}

function validateHeldSessionBridge(
  value: unknown,
  path: string,
  errors: ValidationError[],
): void {
  const bridge = requireRecord(value, path, errors);
  if (!bridge) return;
  requireOneOf(bridge, "benchmark", ["workarena"], path, errors);
  requireOneOf(bridge, "mode", ["held-session-bridge"], path, errors);
  requireBoolean(bridge, "ready", path, errors);
  requireString(bridge, "protocolVersion", path, errors);
  requireString(bridge, "dataset", path, errors);
  const commands = requireArray(bridge.commands, `${path}.commands`, errors);
  commands?.forEach((item, index) => {
    const command = requireRecord(item, `${path}.commands[${index}]`, errors);
    if (!command) return;
    requireOneOf(command, "command", HELD_SESSION_COMMANDS, `${path}.commands[${index}]`, errors);
    requireBoolean(command, "mutatesServiceNow", `${path}.commands[${index}]`, errors);
    requireBoolean(command, "requiresReset", `${path}.commands[${index}]`, errors);
    if (command.requiresAllowServiceNowReset !== undefined) {
      requireBoolean(command, "requiresAllowServiceNowReset", `${path}.commands[${index}]`, errors);
    }
  });
  const state = requireRecord(bridge.state, `${path}.state`, errors);
  if (state) {
    requireBoolean(state, "active", `${path}.state`, errors);
    requireNullableString(state, "taskId", `${path}.state`, errors);
    requireNullableString(state, "envId", `${path}.state`, errors);
    requireNullableNumber(state, "seed", `${path}.state`, errors);
    requireNullableNumber(state, "createdAtMs", `${path}.state`, errors);
  }
  requireStringArray(bridge, "safety", path, errors);
}

function validateHeldSession(value: JsonRecord, path: string, errors: ValidationError[]): void {
  requireOneOf(value, "benchmark", ["workarena"], path, errors);
  requireOneOf(value, "mode", ["held-session"], path, errors);
  requireBoolean(value, "ready", path, errors);
  requireOneOf(value, "status", HELD_SESSION_STATUSES, path, errors);
  const task = requireRecord(value.task, `${path}.task`, errors);
  if (task) {
    requireString(task, "taskId", `${path}.task`, errors);
    requireNumber(task, "seed", `${path}.task`, errors);
  }
  validateHeldSessionBridge(value.bridge, `${path}.bridge`, errors);

  const protocol = requireRecord(value.protocol, `${path}.protocol`, errors);
  if (protocol) {
    requireOneOf(protocol, "transport", ["jsonl-stdio"], `${path}.protocol`, errors);
    requireString(protocol, "script", `${path}.protocol`, errors);
    const sequence = requireArray(protocol.plannedSequence, `${path}.protocol.plannedSequence`, errors);
    sequence?.forEach((item, index) => {
      if (typeof item !== "string" || !HELD_SESSION_COMMANDS.includes(item)) {
        push(
          errors,
          `${path}.protocol.plannedSequence[${index}]`,
          `expected one of: ${HELD_SESSION_COMMANDS.join(", ")}`,
        );
      }
    });
  }

  const reset = requireRecord(value.reset, `${path}.reset`, errors);
  if (reset) {
    requireBoolean(reset, "attempted", `${path}.reset`, errors);
    requireBoolean(reset, "allowServiceNowReset", `${path}.reset`, errors);
    if (reset.result !== null) {
      requireRecord(reset.result, `${path}.reset.result`, errors);
    }
  }

  const next = requireRecord(value.next, `${path}.next`, errors);
  if (next) {
    requireBoolean(next, "canImportSessionIntoExtensionBrowser", `${path}.next`, errors);
    requireString(next, "reason", `${path}.next`, errors);
  }
  requireStringArray(value, "safety", path, errors);
}

function validateFirstTaskCandidate(
  value: unknown,
  path: string,
  errors: ValidationError[],
): void {
  const candidate = requireRecord(value, path, errors);
  if (!candidate) return;
  requireNumber(candidate, "rank", path, errors);
  validateTaskInfo(candidate.task, `${path}.task`, errors);
  requireNumber(candidate, "score", path, errors);
  requireStringArray(candidate, "rationale", path, errors);
  requireString(candidate, "handoffCommand", path, errors);
}

function validateFirstTask(value: JsonRecord, path: string, errors: ValidationError[]): void {
  requireOneOf(value, "benchmark", ["workarena"], path, errors);
  requireOneOf(value, "mode", ["first-task"], path, errors);
  requireBoolean(value, "ready", path, errors);
  requireOneOf(value, "readiness", READINESS_STATUSES, path, errors);
  requireOneOf(value, "suite", SUITES, path, errors);
  requireNumber(value, "seed", path, errors);
  requireNumber(value, "candidateCount", path, errors);
  if (value.selected !== null) {
    validateFirstTaskCandidate(value.selected, `${path}.selected`, errors);
  }
  const candidates = requireArray(value.candidates, `${path}.candidates`, errors);
  candidates?.forEach((candidate, index) => {
    validateFirstTaskCandidate(candidate, `${path}.candidates[${index}]`, errors);
  });
  const doctor = requireRecord(value.doctor, `${path}.doctor`, errors);
  if (doctor) {
    requireBoolean(doctor, "ready", `${path}.doctor`, errors);
    requireOneOf(doctor, "readiness", READINESS_STATUSES, `${path}.doctor`, errors);
    validateChecks(doctor.checks, `${path}.doctor.checks`, errors);
  }
  requireStringArray(value, "notes", path, errors);
}

export function validateWorkArenaReport(value: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  const root = requireRecord(value, "$", errors);
  if (!root) return errors;

  if (root.benchmark !== "workarena") {
    push(errors, "$.benchmark", "expected workarena");
    return errors;
  }

  if (root.mode === "dry") {
    validateDry(root, "$", errors);
  } else if (root.mode === "adapter-plan") {
    validateAdapterPlan(root, "$", errors);
  } else if (root.mode === "guarded-reset") {
    validateResetRun(root, "$", errors);
  } else if (root.mode === "agent-execution") {
    validateExecution(root, "$", errors);
  } else if (root.mode === "browser-strategy") {
    validateBrowserStrategy(root, "$", errors);
  } else if (root.mode === "held-session") {
    validateHeldSession(root, "$", errors);
  } else if (root.mode === "first-task") {
    validateFirstTask(root, "$", errors);
  } else if (root.mode === undefined && Array.isArray(root.checks)) {
    validateDoctor(root, "$", errors);
  } else if (root.mode === undefined && Array.isArray(root.tasks)) {
    validateList(root, "$", errors);
  } else {
    push(
      errors,
      "$.mode",
      "expected dry, adapter-plan, guarded-reset, agent-execution, browser-strategy, held-session, first-task, doctor, or list report",
    );
  }

  return errors;
}
