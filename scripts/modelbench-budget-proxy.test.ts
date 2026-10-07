import assert from "node:assert/strict";
import test from "node:test";
import { responseCost } from "./modelbench-budget-proxy.js";
test("accounts JSON and streamed terminal usage without treating unknown cost as zero", () => {
  assert.equal(responseCost('{"usage":{"cost":0.03}}'), 0.03);
  assert.equal(
    responseCost(
      'data: {"choices":[]}\n\ndata: {"usage":{"cost":0.02}}\n\ndata: [DONE]\n',
    ),
    0.02,
  );
  assert.equal(responseCost('{"error":"timeout"}'), undefined);
  assert.equal(responseCost("data: {broken"), undefined);
});

test("Decisions reserves full context and rejects changed or missing price bounds", async () => {
  const { decisionReservation } = await import("./modelbench-budget-proxy.js");
  const bound = { contextLength: 32000, maxOutputTokens: 0, decisionInputPricePerToken: 0.000000042 };
  const endpoint = { context_length: 32000, pricing: { prompt: "0.000000042", completion: "0" } };
  assert.equal(decisionReservation(bound, [endpoint]), 0.001344);
  assert.throws(() => decisionReservation(bound, []));
  assert.throws(() => decisionReservation(bound, [{ ...endpoint, pricing: { prompt: null, completion: null } }]));
  assert.throws(() => decisionReservation(bound, [{ ...endpoint, context_length: 64000 }]));
  assert.throws(() => decisionReservation(bound, [{ ...endpoint, pricing: { prompt: "0.0000042", completion: "0" } }]));
  assert.throws(() => decisionReservation(bound, [{ ...endpoint, pricing: { prompt: "0.000000042", completion: "0.1" } }]));
});

test("budget bridge dispatches typed Decisions and propagates cancellation without losing reservations", async () => {
  const { installModelBenchBudgetProxy } = await import("./modelbench-budget-proxy.js");
  const { ModelBenchBudget } = await import("./modelbench-budget.js");
  const { mkdtempSync, rmSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "jev-budget-"));
  const path = join(dir, "ledger.json");
  const budget = new ModelBenchBudget(path, 1);
  const callbacks: Record<string, (...args: any[]) => any> = {};
  const page = { exposeFunction: async (name: string, fn: (...args: any[]) => any) => { callbacks[name] = fn; }, evaluate: async () => {} };
  const nativeFetch = globalThis.fetch;
  let started!: () => void;
  let cancelled = false;
  let cancelMode = false;
  try {
    globalThis.fetch = (async (url: any, init: any) => {
      if (String(url).endsWith("/endpoints")) return new Response(JSON.stringify({ data: { endpoints: [{ context_length: 32000, pricing: { prompt: "0.000000042", completion: "0" } }] } }));
      assert.equal(String(url), "https://openrouter.ai/api/alpha/decisions");
      assert.equal(JSON.parse(init.body).model, "typesafe/jev-1.13");
      assert.equal(JSON.parse(init.body).max_tokens, undefined);
      if (!cancelMode) return new Response(JSON.stringify({ usage: { cost: 0.00002 } }));
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => { cancelled = true; reject(init.signal.reason); });
        started();
      });
    }) as typeof fetch;
    await installModelBenchBudgetProxy(page as any, budget, { "typesafe/jev-1.13": { contextLength: 32000, maxOutputTokens: 0, decisionInputPricePerToken: 0.000000042 } });
    const request = { requestId: "first", url: "https://openrouter.ai/api/alpha/decisions", method: "POST", headers: {}, body: JSON.stringify({ model: "typesafe/jev-1.13", state: {}, questions: {} }) };
    await callbacks.__modelBenchBudgetFetch(request);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).entries[0].actualUsd, 0.00002);
    cancelMode = true;
    const dispatched = new Promise<void>(resolve => { started = resolve; });
    const pending = callbacks.__modelBenchBudgetFetch({ ...request, requestId: "cancel" });
    await dispatched;
    callbacks.__modelBenchBudgetAbort("cancel");
    await assert.rejects(pending);
    assert.equal(cancelled, true);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).entries[1].actualUsd, undefined);
    assert.throws(() => budget.reserve("next", 0.01), /Unaccounted/);
  } finally {
    globalThis.fetch = nativeFetch;
    budget.close();
    rmSync(dir, { recursive: true });
  }
});

test("browser proxy survives serialization and cancels without relying on transpiler globals", async () => {
  const { runInNewContext } = await import("node:vm");
  const { installModelBenchBudgetProxy } = await import("./modelbench-budget-proxy.js");
  const context: Record<string, any> = { Request, Response, URL, crypto, fetch, AbortSignal };
  const page = {
    exposeFunction: async (name: string, fn: (...args: any[]) => any) => { context[name] = fn; },
    evaluate: async (fn: () => void) => { runInNewContext(`(${fn.toString()})()`, context); },
  };
  await installModelBenchBudgetProxy(page as any, {} as any, {});
  context.__modelBenchBudgetFetch = async () => ({ status: 200, headers: [], body: 'ready' });
  assert.equal(await (await context.fetch('https://openrouter.ai/api/v1/models')).text(), 'ready');
  let cancelId: string | undefined;
  context.__modelBenchBudgetAbort = async (id: string) => { cancelId = id; };
  context.__modelBenchBudgetFetch = () => new Promise(() => {});
  const controller = new AbortController();
  const pending = context.fetch('https://openrouter.ai/api/v1/models', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending);
  assert.equal(typeof cancelId, 'string');
});


test("explicit model prices govern both routing ceilings and prepaid reservation", async () => {
  const { installModelBenchBudgetProxy } = await import("./modelbench-budget-proxy.js");
  const callbacks: Record<string, (...args: any[]) => any> = {};
  const page = { exposeFunction: async (name: string, fn: (...args: any[]) => any) => { callbacks[name] = fn; }, evaluate: async () => {} };
  let reserved = 0; let settled = 0;
  const budget = { reserve: (_model: string, amount: number) => { reserved = amount; return "one"; }, settle: (_id: string, amount: number) => { settled = amount; } };
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.provider.max_price, { prompt: 5, completion: 15 });
      return new Response(JSON.stringify({ usage: { cost: 0.04 } }));
    }) as typeof fetch;
    await installModelBenchBudgetProxy(page as any, budget as any, { "openai/gpt-6.1-sol": { contextLength: 1050000, maxOutputTokens: 128000, inputUsdPerMillion: 5, outputUsdPerMillion: 15 } });
    await callbacks.__modelBenchBudgetFetch({ requestId: "sol", url: "https://openrouter.ai/api/v1/chat/completions", method: "POST", headers: {}, body: JSON.stringify({ model: "openai/gpt-6.1-sol", max_tokens: 8192 }) });
    assert.equal(reserved, (1050000 * 5 + 8192 * 15) / 1e6);
    assert.equal(settled, 0.04);
  } finally { globalThis.fetch = original; }
});
