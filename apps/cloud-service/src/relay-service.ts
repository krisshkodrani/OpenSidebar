import type { RelayRequestV1 } from "@opensidebar/shared-types";
import { ControlPolicyError } from "./control-policy.js";
import type { ControlRepository } from "./control-repository.js";
import type { CredentialVault } from "./credential-vault.js";

const REQUEST_LIMIT = 2_000;
const TOKEN_LIMIT = 10_000_000;
const GLOBAL_STREAM_LIMIT = 3;
const ACCOUNT_STREAM_LIMIT = 2;
const RESPONSE_LIMIT = 8 * 1024 * 1024;
type RelayLimits = {
  requestLimit: number;
  tokenLimit: number;
  globalStreams: number;
  accountStreams: number;
  responseBytes: number;
  hardTimeoutMs: number;
  idleTimeoutMs: number;
  circuitFailures: number;
  circuitWindowMs: number;
  circuitOpenMs: number;
};
const DEFAULT_LIMITS: RelayLimits = {
  requestLimit: REQUEST_LIMIT,
  tokenLimit: TOKEN_LIMIT,
  globalStreams: GLOBAL_STREAM_LIMIT,
  accountStreams: ACCOUNT_STREAM_LIMIT,
  responseBytes: RESPONSE_LIMIT,
  hardTimeoutMs: 15 * 60_000,
  idleTimeoutMs: 120_000,
  circuitFailures: 5,
  circuitWindowMs: 60_000,
  circuitOpenMs: 30_000,
};

const latencyBucket = (milliseconds: number) =>
  milliseconds < 1_000
    ? "lt_1s"
    : milliseconds < 5_000
      ? "1_5s"
      : milliseconds < 30_000
        ? "5_30s"
        : "gte_30s";

export class RelayService {
  private readonly active = new Map<
    string,
    { accountId: string; abortScopeId: string; controller: AbortController }
  >();
  private readonly failures = new Map<
    string,
    { timestamps: number[]; openUntil: number }
  >();
  private readonly limits: RelayLimits;
  constructor(
    private readonly repository: ControlRepository,
    private readonly vault: Pick<CredentialVault, "decrypt">,
    limits: Partial<RelayLimits> = {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }
  private circuit(provider: string) {
    const now = Date.now(),
      state = this.failures.get(provider);
    if (state && state.openUntil > now)
      throw new Error("provider_circuit_open");
    if (state)
      state.timestamps = state.timestamps.filter(
        (value) => value > now - this.limits.circuitWindowMs,
      );
  }
  private providerFailed(provider: string) {
    const now = Date.now(),
      state = this.failures.get(provider) ?? { timestamps: [], openUntil: 0 };
    state.timestamps = state.timestamps.filter(
      (value) => value > now - this.limits.circuitWindowMs,
    );
    state.timestamps.push(now);
    if (state.timestamps.length >= this.limits.circuitFailures)
      state.openUntil = now + this.limits.circuitOpenMs;
    this.failures.set(provider, state);
  }
  private providerHealthy(provider: string) {
    this.failures.delete(provider);
  }

  concurrent(accountId: string) {
    return [...this.active.values()].filter(
      (item) => item.accountId === accountId,
    ).length;
  }
  cancel(accountId: string, abortScopeId: string) {
    let cancelled = false;
    for (const item of this.active.values())
      if (item.accountId === accountId && item.abortScopeId === abortScopeId) {
        item.controller.abort();
        cancelled = true;
      }
    return cancelled;
  }

  async stream(
    accountId: string,
    request: RelayRequestV1,
    clientSignal: AbortSignal,
  ): Promise<Response> {
    if (
      this.active.size >= this.limits.globalStreams ||
      this.concurrent(accountId) >= this.limits.accountStreams
    )
      throw new ControlPolicyError("quota_exceeded");
    this.circuit(request.provider);
    const activeKey = `${accountId}:${request.requestId}`;
    if (this.active.has(activeKey))
      throw new ControlPolicyError("duplicate_request");
    const controller = new AbortController();
    const abortClient = () => controller.abort();
    clientSignal.addEventListener("abort", abortClient, { once: true });
    const hardTimeout = setTimeout(
      () => controller.abort(),
      this.limits.hardTimeoutMs,
    );
    hardTimeout.unref();
    this.active.set(activeKey, {
      accountId,
      abortScopeId: request.abortScopeId,
      controller,
    });
    const started = Date.now();
    let status: "completed" | "failed" | "cancelled" = "failed";
    let statusClass = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let recorded = false;
    let finished = false;
    const finalize = () => {
      if (finished) return;
      finished = true;
      this.finish(
        activeKey,
        request.requestId,
        accountId,
        status,
        statusClass,
        inputTokens,
        outputTokens,
        started,
        hardTimeout,
        abortClient,
        clientSignal,
        recorded,
      );
    };
    try {
      try {
        await this.repository.beginRelayRequest(
          accountId,
          request.requestId,
          request.provider,
          request.modelId,
          this.limits.requestLimit,
          this.limits.tokenLimit,
        );
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "relay_quota")
          throw new ControlPolicyError("quota_exceeded");
        if (code === "23505") throw new ControlPolicyError("duplicate_request");
        throw error;
      }
      recorded = true;
      const credential = await this.vault.decrypt(accountId, request.provider);
      const endpoint =
        request.provider === "openrouter"
          ? "https://openrouter.ai/api/v1/chat/completions"
          : "https://api.fireworks.ai/inference/v1/chat/completions";
      let upstream: Response;
      try {
        upstream = await fetch(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${credential}`,
            "content-type": "application/json",
            accept: "text/event-stream",
          },
          body: JSON.stringify({
            model: request.modelId,
            messages: request.messages,
            tools: request.tools,
            temperature: request.temperature,
            max_tokens: request.maxTokens,
            stop: request.stop,
            response_format: request.responseFormat,
            tool_choice: request.toolChoice,
            stream: true,
            stream_options: { include_usage: true },
          }),
        });
      } catch (error) {
        if (!controller.signal.aborted) this.providerFailed(request.provider);
        throw error;
      }
      statusClass = Math.floor(upstream.status / 100);
      if (!upstream.ok || !upstream.body) {
        if (upstream.status >= 500) this.providerFailed(request.provider);
        await upstream.body?.cancel();
        throw new Error(
          upstream.status >= 500 ? "provider_unavailable" : "provider_rejected",
        );
      }
      this.providerHealthy(request.provider);
      const decoder = new TextDecoder(),
        limits = this.limits;
      let pending = "",
        responseBytes = 0;
      let idleTimer: NodeJS.Timeout;
      const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(
          () => controller.abort(),
          this.limits.idleTimeoutMs,
        );
        idleTimer.unref();
      };
      resetIdle();
      const reader = upstream.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(streamController) {
          try {
            const chunk = await reader.read();
            resetIdle();
            if (chunk.done) {
              clearTimeout(idleTimer);
              status = "completed";
              streamController.close();
              finalize();
              return;
            }
            responseBytes += chunk.value.byteLength;
            if (responseBytes > limits.responseBytes) {
              controller.abort();
              throw new Error("provider_response_too_large");
            }
            pending += decoder.decode(chunk.value, { stream: true });
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";
            for (const line of lines) {
              if (
                !line.startsWith("data:") ||
                line.slice(5).trim() === "[DONE]"
              )
                continue;
              try {
                const parsed = JSON.parse(line.slice(5)) as {
                  usage?: {
                    prompt_tokens?: number;
                    completion_tokens?: number;
                  };
                };
                inputTokens = Math.max(
                  inputTokens,
                  parsed.usage?.prompt_tokens ?? 0,
                );
                outputTokens = Math.max(
                  outputTokens,
                  parsed.usage?.completion_tokens ?? 0,
                );
              } catch {
                /* provider data remains opaque */
              }
            }
            streamController.enqueue(chunk.value);
          } catch (error) {
            clearTimeout(idleTimer);
            status = controller.signal.aborted ? "cancelled" : "failed";
            streamController.error(error);
            finalize();
          }
        },
        cancel() {
          clearTimeout(idleTimer);
          controller.abort();
          void reader.cancel();
          status = "cancelled";
          finalize();
        },
      });
      return new Response(body, {
        status: upstream.status,
        headers: {
          "content-type":
            upstream.headers.get("content-type") ?? "text/event-stream",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        },
      });
    } catch (error) {
      status = controller.signal.aborted ? "cancelled" : "failed";
      finalize();
      throw error;
    }
  }

  private finish(
    activeKey: string,
    requestId: string,
    accountId: string,
    status: "completed" | "failed" | "cancelled",
    statusClass: number,
    inputTokens: number,
    outputTokens: number,
    started: number,
    hardTimeout: NodeJS.Timeout,
    abortClient: () => void,
    clientSignal: AbortSignal,
    recorded: boolean,
  ) {
    clearTimeout(hardTimeout);
    clientSignal.removeEventListener("abort", abortClient);
    this.active.delete(activeKey);
    if (recorded)
      void this.repository
        .finishRelayRequest(
          accountId,
          requestId,
          status,
          statusClass,
          inputTokens,
          outputTokens,
          latencyBucket(Date.now() - started),
        )
        .catch((error) => console.error("relay accounting failed", error));
  }
}
