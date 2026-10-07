import type { CredentialVault } from "./credential-vault.js";
import { ControlPolicyError } from "./control-policy.js";

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Authenticated, model-allowlisted discovery; never returns credential material. */
export async function readOpenRouterEndpoints(
  vault: Pick<CredentialVault, "decrypt">,
  accountId: string,
  model: string,
  allowlist: ReadonlySet<string>,
  signal: AbortSignal,
) {
  if (
    !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i.test(model) ||
    !allowlist.has(model)
  )
    throw new ControlPolicyError("invalid_request");
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
  boundedSignal.throwIfAborted();
  const credential = await vault.decrypt(accountId, "openrouter");
  boundedSignal.throwIfAborted();
  try {
    const response = await fetch(
      `https://openrouter.ai/api/v1/models/${model.split("/").map(encodeURIComponent).join("/")}/endpoints`,
      {
        headers: { authorization: `Bearer ${credential}` },
        signal: boundedSignal,
      },
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error("metadata unavailable");
    }
    const reader = response.body.getReader();
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 512 * 1024) throw new Error("metadata too large");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    boundedSignal.throwIfAborted();
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const endpoints = record(record(parsed).data).endpoints;
    if (!Array.isArray(endpoints) || endpoints.length > 1000)
      throw new Error("invalid metadata");
    return {
      data: {
        endpoints: endpoints.map((value: unknown) => {
          const endpoint = record(value);
          const price = record(endpoint.pricing).completion;
          return {
            tag: typeof endpoint.tag === "string" ? endpoint.tag : null,
            status: finite(endpoint.status),
            pricing: { completion: typeof price === "string" ? price : null },
            latency_last_30m: {
              p50: finite(record(endpoint.latency_last_30m).p50),
            },
            throughput_last_30m: {
              p50: finite(record(endpoint.throughput_last_30m).p50),
            },
          };
        }),
      },
    };
  } catch {
    signal.throwIfAborted();
    throw new ControlPolicyError("verification_failed");
  }
}
