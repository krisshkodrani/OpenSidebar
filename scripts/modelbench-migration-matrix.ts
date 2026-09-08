#!/usr/bin/env tsx

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { MODEL_BENCH_CASES } from "@opensidebar/scenario-engine";
import { ARENA_TASKS } from "../apps/extension/tests/e2e/arena/tasks.js";
import {
  E2E_CANONICAL_SUITE_ORDER,
  E2E_SUITES,
  type E2ESuiteName,
} from "../apps/extension/tests/e2e/suites.js";

export type MigrationDisposition =
  | "modelbench_case"
  | "contract_test"
  | "external_adapter"
  | "delete";

export interface LegacyMigrationEntry {
  legacyId: string;
  source: string;
  suite: E2ESuiteName | "arena-catalog";
  title: string;
  disposition: MigrationDisposition;
  replacements: string[];
  rationale: string;
}

const CONTRACT_FILES = new Set([
  "bridge-approval-forwarding.test.ts",
  "browser-bridge.test.ts",
  "completion-done.test.ts",
  "lane-topology.test.ts",
  "local-mock-provider-video.test.ts",
  "overlay-harness.test.ts",
  "overlay-panel-surfaces.test.ts",
  "portable-cloud-restore-disabled.test.ts",
  "session-state-import.test.ts",
  "suite-hygiene.test.ts",
]);

const EXTERNAL_FILES = new Set([
  "ashby-job-application.test.ts",
  "showcase-ashby-application.test.ts",
  "showcase-job-pipeline.test.ts",
  "showcase-live-application.test.ts",
]);

const CASE_BY_SIGNAL: Array<[RegExp, string]> = [
  [/job|ashby|application/i, "jobs.recover-multistep-application"],
  [/shop|cart|checkout|coupon/i, "retail.checkout-multi-item"],
  [/approval/i, "procurement.recover-stale-approval"],
  [/clarification/i, "crm.clarify-ambiguous-owner"],
  [/continuation-cross-tab|parallel|tab-management/i, "durability.continue-across-tab"],
  [/continuation|restart|failover|stop-drain|mutation-dedupe/i, "durability.preserve-state-through-failover"],
  [/perception|canvas|visual/i, "analytics.inspect-canvas-tooltip"],
  [/information|summarize|article|faq|footnote/i, "knowledge.read-footnote-source"],
  [/renewal|data-table|salary|record/i, "records.reconcile-and-update-records"],
  [/sports|dashboard|chart/i, "analytics.cross-dashboard-brief"],
  [/vendor|procurement/i, "procurement.process-first-two-requests"],
  [/redteam|injection|security/i, "knowledge.ignore-document-injection"],
  [/watch|delayed|structural-loading|infinite-scroll/i, "monitoring.recover-monitor-reconnect"],
  [/form|autocomplete|combobox|date-picker|registration/i, "hr.recover-validation-errors"],
  [/navigation|hover|context-menu|keyboard|modal|web-components|execute-js/i, "records.edit-reference-field"],
  [/memory|cache/i, "durability.resume-multistep-plan"],
  [/sequential|multi-turn|escalation/i, "crm.escalate-with-account-context"],
];

function replacementFor(signal: string): string {
  return CASE_BY_SIGNAL.find(([pattern]) => pattern.test(signal))?.[1] ??
    "durability.resume-multistep-plan";
}

function suiteByFile(): Map<string, E2ESuiteName> {
  const result = new Map<string, E2ESuiteName>();
  for (const suite of E2E_CANONICAL_SUITE_ORDER) {
    for (const file of E2E_SUITES[suite]) result.set(file, suite);
  }
  return result;
}

function testTitle(node: ts.CallExpression, source: ts.SourceFile): string | null {
  const expression = node.expression;
  const name = ts.isIdentifier(expression)
    ? expression.text
    : ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)
      ? expression.expression.text
      : null;
  if (name !== "test" && name !== "it") return null;
  const first = node.arguments[0];
  if (!first) return "<missing title>";
  if (ts.isStringLiteralLike(first)) return first.text;
  return first.getText(source).replace(/\s+/g, " ").slice(0, 180);
}

export function buildLegacyMigrationMatrix(): LegacyMigrationEntry[] {
  const root = resolve("apps/extension/tests/e2e");
  const suites = suiteByFile();
  const entries: LegacyMigrationEntry[] = [];
  for (const [file, suite] of [...suites].sort(([left], [right]) => left.localeCompare(right))) {
    const path = resolve(root, file);
    const source = ts.createSourceFile(
      file,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const title = testTitle(node, source);
        if (title) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          const disposition: MigrationDisposition = CONTRACT_FILES.has(file)
            ? "contract_test"
            : EXTERNAL_FILES.has(file)
              ? "external_adapter"
              : file === "arena-suite.test.ts"
                ? "delete"
                : "modelbench_case";
          const replacement = replacementFor(`${file} ${title}`);
          entries.push({
            legacyId: `${file}:${line}`,
            source: `apps/extension/tests/e2e/${file}`,
            suite,
            title,
            disposition,
            replacements:
              disposition === "modelbench_case"
                ? [replacement]
                : disposition === "contract_test"
                  ? [`contract:${file.replace(/\.test\.ts$/, "")}`]
                  : disposition === "external_adapter"
                    ? ["external:jobagent"]
                    : ["modelbench:runner-contracts"],
            rationale:
              disposition === "modelbench_case"
                ? "The observable browser objective is represented by a deterministic ModelBench workflow."
                : disposition === "contract_test"
                  ? "This checks harness/runtime plumbing and must move to a focused contract test, not a scored browser case."
                  : disposition === "external_adapter"
                    ? "This remains a reference or external adapter and must not depend on the legacy fixture catalog."
                    : "The legacy Arena wrapper is superseded by the ModelBench runner and deterministic validators.",
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const task of ARENA_TASKS) {
    entries.push({
      legacyId: `arena:${task.id}`,
      source: "apps/extension/tests/e2e/arena/tasks.ts",
      suite: "arena-catalog",
      title: task.title,
      disposition: "modelbench_case",
      replacements: [replacementFor(`${task.id} ${task.title}`)],
      rationale: "The Arena objective moves to a versioned ModelBench case; the Arena-specific catalog and validator are deleted.",
    });
  }
  return entries;
}

export function checkLegacyMigrationMatrix(entries = buildLegacyMigrationMatrix()): string[] {
  const errors: string[] = [];
  const caseIds = new Set(MODEL_BENCH_CASES.map((definition) => definition.contract.id));
  const expectedFiles = new Set([...suiteByFile().keys()]);
  const coveredFiles = new Set(entries.filter((entry) => entry.suite !== "arena-catalog").map((entry) => entry.source.split("/").at(-1)!));
  for (const file of expectedFiles) {
    if (!coveredFiles.has(file)) errors.push(`${file}: no lexical test entry was inventoried`);
  }
  for (const entry of entries) {
    if (!entry.rationale.trim()) errors.push(`${entry.legacyId}: missing rationale`);
    if (!entry.replacements.length) errors.push(`${entry.legacyId}: missing replacement`);
    for (const replacement of entry.replacements) {
      if (entry.disposition === "modelbench_case" && !caseIds.has(replacement)) {
        errors.push(`${entry.legacyId}: unknown ModelBench case ${replacement}`);
      }
    }
  }
  const arenaEntries = entries.filter((entry) => entry.suite === "arena-catalog");
  if (arenaEntries.length !== ARENA_TASKS.length) {
    errors.push(`Arena inventory has ${arenaEntries.length}; expected ${ARENA_TASKS.length}`);
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const entries = buildLegacyMigrationMatrix();
  const errors = checkLegacyMigrationMatrix(entries);
  if (process.argv.includes("--json")) console.log(JSON.stringify({ entries, errors }, null, 2));
  else console.log(`[modelbench:migration] ${entries.length} legacy entries; ${errors.length} error(s).`);
  if (errors.length) process.exitCode = 1;
}
