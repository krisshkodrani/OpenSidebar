import { isJevModel } from "../apps/extension/src/background/llm/jev-decision.js";
import type { Page } from "puppeteer";
import { ModelBenchBudget } from "./modelbench-budget.js";

interface ProxyRequest {
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}
interface ModelBound {
  contextLength: number;
  maxOutputTokens: number;
  decisionInputPricePerToken?: number;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
}

export function responseCost(body: string): number | undefined {
  const payloads =
    body.startsWith("data:") || body.includes("\ndata:")
      ? body
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .filter((line) => line !== "[DONE]")
      : [body];
  let cost: number | undefined;
  for (const payload of payloads) {
    try {
      const usage = JSON.parse(payload).usage;
      if (
        typeof usage?.cost === "number" &&
        Number.isFinite(usage.cost) &&
        usage.cost >= 0
      )
        cost = usage.cost;
    } catch {
      /* Incomplete/error events cannot clear the reservation. */
    }
  }
  return cost;
}

/** Node owns provider egress; Chromium DNS is disabled for this host in budgeted runs. */
export async function installModelBenchBudgetProxy(
  page: Page,
  budget: ModelBenchBudget,
  bounds: Record<string, ModelBound>,
) {
  let queue = Promise.resolve();
  const controllers = new Map<string, AbortController>();
  await page.exposeFunction("__modelBenchBudgetAbort", (requestId: string) =>
    controllers.get(requestId)?.abort(),
  );
  await page.exposeFunction(
    "__modelBenchBudgetFetch",
    (input: ProxyRequest) => {
      const controller = new AbortController();
      controllers.set(input.requestId, controller);
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(120000),
      ]);
      const work = queue.then(async () => {
        signal.throwIfAborted();
        const url = new URL(input.url);
        if (url.origin !== "https://openrouter.ai")
          throw new Error("Unexpected provider origin");
        let reservation: string | undefined;
        let body = input.body;
        if (input.method === "POST") {
          if (
            !["/api/v1/chat/completions", "/api/alpha/decisions"].includes(
              url.pathname,
            )
          )
            throw new Error("Unbudgeted provider operation");
          const payload = JSON.parse(body ?? "{}");
          const bound = bounds[payload.model];
          if (!bound) throw new Error(`Unpriced model: ${payload.model}`);
          if (url.pathname === "/api/alpha/decisions") {
            if (!isJevModel(payload.model))
              throw new Error("Unbudgeted Decisions model");
            const metadataResponse = await fetch(
              `https://openrouter.ai/api/v1/models/${payload.model}/endpoints`,
              { signal },
            );
            if (!metadataResponse.ok)
              throw new Error("Cannot verify Decisions pricing");
            const metadata = await metadataResponse.json();
            const maximum = decisionReservation(
              bound,
              metadata.data?.endpoints,
            );
            signal.throwIfAborted();
            reservation = budget.reserve(payload.model, maximum);
          } else {
            if (isJevModel(payload.model))
              throw new Error("Jev requires the Decisions endpoint");
            const maxOutput =
              payload.max_tokens ??
              payload.max_completion_tokens ??
              bound.maxOutputTokens;
            if (
              !Number.isInteger(maxOutput) ||
              maxOutput <= 0 ||
              maxOutput > bound.maxOutputTokens
            )
              throw new Error("Unbounded output tokens");
            // Explicit campaign bounds; old manifests retain their original ceilings.
            const inputPrice = bound.inputUsdPerMillion ?? 1;
            const outputPrice = bound.outputUsdPerMillion ?? 5;
            if (![inputPrice, outputPrice].every((price) => Number.isFinite(price) && price > 0))
              throw new Error("Invalid model price bounds");
            const provider = payload.provider ?? {};
            const maxPrice = provider.max_price ?? {};
            payload.provider = {
              ...provider,
              max_price: {
                ...maxPrice,
                prompt: Math.min(maxPrice.prompt ?? inputPrice, inputPrice),
                completion: Math.min(maxPrice.completion ?? outputPrice, outputPrice),
              },
            };
            payload.max_tokens = maxOutput;
            body = JSON.stringify(payload);
            reservation = budget.reserve(
              payload.model,
              (bound.contextLength * inputPrice + maxOutput * outputPrice) / 1e6,
            );
          }
        } else if (
          !["GET", "HEAD"].includes(input.method) ||
          !url.pathname.startsWith("/api/v1/models")
        ) {
          throw new Error("Unbudgeted provider operation");
        }
        const response = await fetch(url, {
          method: input.method,
          headers: input.headers,
          body,
          signal,
        });
        const text = await response.text();
        if (reservation) budget.settle(reservation, responseCost(text));
        return {
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers.entries()],
          body: text,
        };
      });
      queue = work.then(
        () => undefined,
        () => undefined,
      );
      return work.finally(() => controllers.delete(input.requestId));
    },
  );
  await page.evaluate(() => {
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (new URL(request.url).origin !== "https://openrouter.ai")
        return nativeFetch(input, init);
      const bridge = (
        globalThis as unknown as {
          __modelBenchBudgetFetch(input: ProxyRequest): Promise<{
            status: number;
            statusText: string;
            headers: [string, string][];
            body: string;
          }>;
        }
      ).__modelBenchBudgetFetch;
      const requestId = crypto.randomUUID();
      const body = ["GET", "HEAD"].includes(request.method)
        ? undefined
        : await request.text();
      request.signal.throwIfAborted();
      const abortBridge = (
        globalThis as unknown as {
          __modelBenchBudgetAbort(id: string): Promise<void>;
        }
      ).__modelBenchBudgetAbort;
      let abort: EventListenerObject | undefined;
      const cancelled = new Promise<never>((_, reject) => {
        abort = { handleEvent() {
          void abortBridge(requestId);
          reject(request.signal.reason);
        } };
        request.signal.addEventListener("abort", abort, { once: true });
      });
      try {
        const result = await Promise.race([
          bridge({
            requestId,
            url: request.url,
            method: request.method,
            headers: Object.fromEntries(request.headers.entries()),
            body,
          }),
          cancelled,
        ]);
        return new Response(
          request.method === "HEAD" ? null : result.body,
          result,
        );
      } finally {
        if (abort) request.signal.removeEventListener("abort", abort);
      }
    };
  });
}

/** Decisions have no chat max_tokens parameter; reserve their full verified context. */
export function decisionReservation(
  bound: ModelBound,
  endpoints: unknown,
): number {
  const price = bound.decisionInputPricePerToken;
  if (
    !price ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isSafeInteger(bound.contextLength) ||
    bound.contextLength <= 0 ||
    !Array.isArray(endpoints) ||
    endpoints.length === 0
  ) {
    throw new Error("Missing Decisions pricing/context bound");
  }
  for (const endpoint of endpoints) {
    const parsePrice = (value: unknown) =>
      typeof value === "number" ||
      (typeof value === "string" && value.trim() !== "")
        ? Number(value)
        : NaN;
    const inputPrice = parsePrice(endpoint.pricing?.prompt);
    const outputPrice = parsePrice(endpoint.pricing?.completion);
    if (
      !Number.isSafeInteger(endpoint.context_length) ||
      endpoint.context_length <= 0 ||
      endpoint.context_length > bound.contextLength ||
      !Number.isFinite(inputPrice) ||
      inputPrice < 0 ||
      inputPrice > price ||
      outputPrice !== 0
    ) {
      throw new Error("Decisions endpoint exceeds frozen bound");
    }
  }
  return bound.contextLength * price;
}
