import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  isFleetTelemetryEnvelopeV1,
  type FleetTelemetryEnvelopeV1,
} from "../../../packages/observability-schema/src/fleet-telemetry.ts";

export const MAX_INGEST_BYTES = 32 * 1024;

export interface FirehoseWriter {
  put(record: FleetTelemetryEnvelopeV1): Promise<void>;
}

export interface IngestResponse {
  statusCode: number;
  headers: { "content-type": "application/json" };
  body: string;
}

export type FleetTelemetryIngestHandler = (
  event: APIGatewayProxyEventV2,
) => Promise<IngestResponse>;

export function createIngestHandler(
  writer: FirehoseWriter,
): FleetTelemetryIngestHandler {
  return async (event) => {
    if (event.requestContext.http.method !== "POST") {
      return response(405, { error: "method_not_allowed" });
    }
    const contentEncoding = Object.entries(event.headers ?? {}).find(
      ([name]) => name.toLowerCase() === "content-encoding",
    )?.[1];
    if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
      return response(415, { error: "content_encoding_not_supported" });
    }

    const raw = event.body
      ? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8")
      : Buffer.alloc(0);
    if (raw.byteLength === 0 || raw.byteLength > MAX_INGEST_BYTES) {
      return response(413, { error: "payload_too_large_or_empty" });
    }

    let value: unknown;
    try {
      value = JSON.parse(raw.toString("utf8"));
    } catch {
      return response(400, { error: "invalid_json" });
    }
    if (!isFleetTelemetryEnvelopeV1(value)) {
      return response(400, { error: "invalid_schema" });
    }

    try {
      await writer.put(value);
    } catch {
      return response(503, { error: "temporarily_unavailable" });
    }
    return response(202, { accepted: true });
  };
}

function response(
  statusCode: number,
  body: Record<string, unknown>,
): IngestResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
