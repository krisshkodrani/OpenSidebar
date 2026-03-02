import { readFileSync } from "fs";

const file = process.argv[2] || "traces/875873f9-277d-4685-94b7-bf19be2f2f5e.jsonl";
const lines = readFileSync(file, "utf8").trim().split("\n");

let maxTurn = 0;
for (let i = 0; i < lines.length; i++) {
  const d = JSON.parse(lines[i]);
  const turn = d.turnNumber ?? 0;
  if (turn > maxTurn) maxTurn = turn;
  const url = (d.snapshot?.url ?? "").replace(/.*netlify\.app/, "");
  const elems = d.elements?.length ?? 0;
  const tools = d.toolExecutions?.length ?? 0;
  const toolNames = (d.toolExecutions ?? []).map((t: any) => t.toolName).join(",");
  const respTools = d.llmResponse?.toolCalls?.length ?? 0;
  const respText = d.llmResponse?.content ? d.llmResponse.content.slice(0, 60) : "";
  console.log(
    `T${String(turn).padStart(3)} | elems=${String(elems).padStart(3)} | tools=${tools} ${toolNames.padEnd(20)} | llmTools=${respTools} | ${url}`
  );
}
console.log(`\nTotal entries: ${lines.length}, max turn: ${maxTurn}`);
