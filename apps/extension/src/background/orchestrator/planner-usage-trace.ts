import { redactTracePayload } from "../../utils/trace-protection";

const MAX_PLANNER_TRACE_RESPONSE_CHARS = 32_000;

export function protectPlannerTraceResponse(rawResponse: string): string {
  return redactTracePayload(rawResponse, {
    mode: "export",
    maxStringLength: MAX_PLANNER_TRACE_RESPONSE_CHARS,
  });
}
