/**
 * Extract tool definitions from the registry to a static JSON file.
 * Used by the eval runner to provide tools when golden cases have tools: [].
 */

// We can't import the full tools/index.ts (Chrome deps), so we parse the source.
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const SOURCE = join("src", "background", "tools", "index.ts");
const OUTPUT = join("evals", "tool-definitions.json");

const source = readFileSync(SOURCE, "utf-8");

// Extract all ToolDefinition objects by finding const XXX_DEF: ToolDefinition = { ... };
// These are well-structured static objects, so we can extract them with regex + balanced braces.
const defs: any[] = [];

// Find each "const XXXX_DEF: ToolDefinition = {" and extract the balanced object
const defPattern = /const\s+\w+_DEF:\s*ToolDefinition\s*=\s*\{/g;
let match;
while ((match = defPattern.exec(source)) !== null) {
  const startIdx = match.index + match[0].length - 1; // position of opening {
  let depth = 1;
  let i = startIdx + 1;
  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    i++;
  }
  const objStr = source.slice(startIdx, i);

  // Convert TypeScript to valid JSON-ish: replace ToolName.XXX with "xxx" 
  let jsonish = objStr
    // Replace ToolName.XXX_YYY with the snake_case string
    .replace(/ToolName\.(\w+)/g, (_, name) => `"${name.toLowerCase()}"`)
    // Remove trailing commas before } or ]
    .replace(/,\s*([}\]])/g, "$1")
    // Remove single-line comments
    .replace(/\/\/[^\n]*/g, "");

  try {
    // Use Function constructor to evaluate (safer than eval for static objects)
    const obj = new Function(`return (${jsonish})`)();
    defs.push(obj);
  } catch (e) {
    // Some defs may have complex expressions — skip those
    const nameMatch = objStr.match(/"name":\s*"([^"]+)"/);
    console.warn(`  Skipped: ${nameMatch?.[1] ?? "unknown"} — ${(e as Error).message}`);
  }
}

writeFileSync(OUTPUT, JSON.stringify(defs, null, 2), "utf-8");
console.log(`Extracted ${defs.length} tool definitions to ${OUTPUT}`);
