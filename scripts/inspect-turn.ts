import { readFileSync } from "fs";

const file = "traces/875873f9-277d-4685-94b7-bf19be2f2f5e.jsonl";
const lines = readFileSync(file, "utf8").trim().split("\n");
const d = JSON.parse(lines[0]);

console.log("=== TURN 1 ===");
console.log("snapshot:", JSON.stringify(d.snapshot));
console.log("elements count:", d.elements?.length);
console.log("llmRequest keys:", Object.keys(d.llmRequest || {}));
console.log("llmRequest.messages count:", d.llmRequest?.messages?.length);
console.log("llmRequest.messages roles:", d.llmRequest?.messages?.map((m: any) => m.role));
console.log("llmResponse keys:", Object.keys(d.llmResponse || {}));
console.log("llmResponse.content (first 200):", d.llmResponse?.content?.slice(0, 200));
console.log("llmResponse.toolCalls:", JSON.stringify(d.llmResponse?.toolCalls));
console.log("toolExecutions:", JSON.stringify(d.toolExecutions?.map((t: any) => ({
  name: t.toolName,
  args: t.args,
  result: typeof t.result === "string" ? t.result.slice(0, 100) : JSON.stringify(t.result).slice(0, 100),
}))));

// Also show turn 2 to see how history builds
const d2 = JSON.parse(lines[1]);
console.log("\n=== TURN 2 ===");
console.log("llmRequest.messages count:", d2.llmRequest?.messages?.length);
console.log("llmRequest.messages roles:", d2.llmRequest?.messages?.map((m: any) => m.role));
// Show the tool result message
const toolResultMsg = d2.llmRequest?.messages?.find((m: any) => m.role === "tool");
if (toolResultMsg) {
  console.log("tool result msg:", JSON.stringify(toolResultMsg).slice(0, 300));
}
console.log("llmResponse.toolCalls:", JSON.stringify(d2.llmResponse?.toolCalls));
console.log("toolExecutions:", JSON.stringify(d2.toolExecutions?.map((t: any) => ({
  name: t.toolName,
  args: t.args,
  result: typeof t.result === "string" ? t.result.slice(0, 100) : JSON.stringify(t.result).slice(0, 100),
}))));
