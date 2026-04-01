/**
 * Generate golden baselines by running each eval case against a top model (GPT-5.4).
 *
 * Usage:
 *   node scripts/generate-golden-baselines.mjs [--dry-run] [--filter <pattern>]
 *
 * Reads OPENROUTER_API_KEY from .env. Sends each golden case's input to the
 * specified model (default: openai/gpt-5.4) and saves the raw output alongside
 * a review report.
 *
 * The baselines are NOT auto-accepted — human must review review.md and mark
 * each case as ACCEPT/REJECT before updating the golden expected fields.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

// ── Config ──────────────────────────────────────────────────────────────────

const GOLDEN_DIR = "evals/golden";
const BASELINE_DIR = "evals/golden/baselines";
const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-5.4";
const PERCEPTION_MODEL = "openai/gpt-5.4"; // Use same top model for perception too

// ── API Key ─────────────────────────────────────────────────────────────────

function loadApiKey() {
  for (const envFile of [".env", ".env.local"]) {
    if (existsSync(envFile)) {
      const content = readFileSync(envFile, "utf8");
      const match = content.match(/OPENROUTER_API_KEY=(.+)/);
      if (match) return match[1].trim();
    }
  }
  throw new Error("OPENROUTER_API_KEY not found in .env");
}

// ── OpenRouter Call ─────────────────────────────────────────────────────────

async function callModel(messages, model, tools) {
  const apiKey = loadApiKey();
  const body = {
    model,
    messages,
    temperature: 0,
    max_tokens: 4096,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const resp = await fetch(OPENROUTER_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://opensidebar.dev",
      "X-Title": "OpenSidebar Golden Baseline Generation",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error ${resp.status}: ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  const choice = data.choices?.[0];
  if (!choice) throw new Error("No choice in API response");

  const toolCalls = (choice.message?.tool_calls || []).map((tc) => ({
    toolName: tc.function?.name || "",
    args: JSON.parse(tc.function?.arguments || "{}"),
  }));
  const text = choice.message?.content || null;

  return {
    toolCalls,
    text,
    model: data.model || model,
    usage: data.usage || null,
  };
}

// ── Load Cases ──────────────────────────────────────────────────────────────

function loadGoldenCases(filterPattern) {
  const files = readdirSync(GOLDEN_DIR)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => !filterPattern || f.includes(filterPattern));

  return files.map((f) => ({
    filename: f,
    ...JSON.parse(readFileSync(join(GOLDEN_DIR, f), "utf8")),
  }));
}

// ── Compare Output ──────────────────────────────────────────────────────────

function compareToolCalls(expected, actual) {
  if (!expected?.toolCalls?.length && !actual?.toolCalls?.length) return "MATCH_NONE";
  if (!expected?.toolCalls?.length) return "UNEXPECTED_TOOLS";
  if (!actual?.toolCalls?.length) return "MISSING_TOOLS";

  const expName = expected.toolCalls[0]?.toolName;
  const actName = actual.toolCalls[0]?.toolName;
  if (expName !== actName) return `TOOL_MISMATCH (expected: ${expName}, got: ${actName})`;

  // For done() calls, just check tool name matches
  if (expName === "done") return "MATCH_TOOL";

  // Check args match
  const expArgs = expected.toolCalls[0]?.args || {};
  const actArgs = actual.toolCalls[0]?.args || {};
  const expKeys = Object.keys(expArgs).filter((k) => expArgs[k] !== undefined);

  let argsMatch = true;
  for (const key of expKeys) {
    if (JSON.stringify(expArgs[key]) !== JSON.stringify(actArgs[key])) {
      argsMatch = false;
      break;
    }
  }

  return argsMatch ? "MATCH_FULL" : "MATCH_TOOL_ARGS_DIFFER";
}

function compareText(expected, actual) {
  if (!expected?.text && !actual?.text) return "MATCH_NONE";
  if (!expected?.text) return "UNEXPECTED_TEXT";
  if (!actual?.text) return "MISSING_TEXT";

  // For verifier cases, check if the key decision word appears
  const expLower = expected.text.toLowerCase();
  const actLower = actual.text.toLowerCase();
  if (expLower.includes("accept") && actLower.includes("accept")) return "MATCH_DECISION";
  if (expLower.includes("retry") && actLower.includes("retry")) return "MATCH_DECISION";
  return "DECISION_MISMATCH";
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filterIdx = args.indexOf("--filter");
  const filterPattern = filterIdx >= 0 ? args[filterIdx + 1] : null;

  if (!existsSync(BASELINE_DIR)) mkdirSync(BASELINE_DIR, { recursive: true });

  const cases = loadGoldenCases(filterPattern);
  console.log(`\nLoaded ${cases.length} golden cases${filterPattern ? ` (filter: ${filterPattern})` : ""}`);
  if (dryRun) {
    console.log("DRY RUN — not calling API");
    for (const c of cases) console.log(`  ${c.id}: ${c.metadata?.pathology || "unknown"}`);
    return;
  }

  const results = [];
  const report = ["# Golden Baseline Review\n", `Date: ${new Date().toISOString().split("T")[0]}`, `Model: ${DEFAULT_MODEL}`, `Cases: ${cases.length}\n`, "---\n"];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    console.log(`[${i + 1}/${cases.length}] ${c.id}...`);

    try {
      // Build messages
      const messages = [
        { role: "system", content: c.input.systemPrompt },
        ...c.input.conversationHistory,
      ];

      const model = c.metadata?.tags?.includes("perception") ? PERCEPTION_MODEL : DEFAULT_MODEL;
      const output = await callModel(messages, model, c.input.tools || []);

      // Compare with hand-written expected
      const toolMatch = compareToolCalls(c.expected, output);
      const textMatch = compareText(c.expected, output);
      const isMatch = toolMatch.startsWith("MATCH") || textMatch.startsWith("MATCH");

      const baseline = {
        caseId: c.id,
        model: output.model,
        modelOutput: { toolCalls: output.toolCalls, text: output.text },
        handWrittenExpected: c.expected,
        toolMatch,
        textMatch,
        matchesExpected: isMatch,
        reviewStatus: "pending",
        usage: output.usage,
      };

      writeFileSync(join(BASELINE_DIR, `${c.id}.json`), JSON.stringify(baseline, null, 2));
      results.push(baseline);

      // Build report entry
      const icon = isMatch ? "✅" : "❌";
      report.push(`### ${icon} ${c.id}`);
      report.push(`**Pathology:** ${c.metadata?.pathology || "unknown"}`);
      report.push(`**Description:** ${c.metadata?.description || ""}`);
      report.push("");
      if (c.expected?.toolCalls?.length) {
        report.push(`**Expected tool:** \`${c.expected.toolCalls[0].toolName}(${JSON.stringify(c.expected.toolCalls[0].args)})\``);
      }
      if (c.expected?.text) {
        report.push(`**Expected text contains:** \`${c.expected.text.slice(0, 80)}\``);
      }
      report.push("");
      if (output.toolCalls?.length) {
        report.push(`**Model output:** \`${output.toolCalls[0].toolName}(${JSON.stringify(output.toolCalls[0].args).slice(0, 200)})\``);
      }
      if (output.text) {
        report.push(`**Model text:** \`${output.text.slice(0, 200)}\``);
      }
      report.push(`**Tool match:** ${toolMatch}`);
      report.push(`**Text match:** ${textMatch}`);
      report.push(`**Review:** [PENDING]\n`);
      report.push("---\n");

      console.log(`  ${icon} ${toolMatch} ${textMatch}`);

      // Rate limit: 200ms between calls
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      report.push(`### ⚠️ ${c.id}`);
      report.push(`**Error:** ${err.message}\n`);
      report.push("---\n");
    }
  }

  // Write summary report
  const matchCount = results.filter((r) => r.matchesExpected).length;
  report.splice(4, 0, `Results: ${matchCount}/${results.length} match hand-written expectations\n`);
  writeFileSync(join(BASELINE_DIR, "review.md"), report.join("\n"));

  console.log(`\n════════════════════════════════════`);
  console.log(`Results: ${matchCount}/${results.length} match`);
  console.log(`Baselines saved to: ${BASELINE_DIR}/`);
  console.log(`Review report: ${BASELINE_DIR}/review.md`);
  console.log(`\nNext step: review review.md, mark each case ACCEPT/REJECT,`);
  console.log(`then run: node scripts/apply-golden-baselines.mjs`);
}

main().catch(console.error);
