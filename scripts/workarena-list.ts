#!/usr/bin/env tsx

import {
  type ListResult,
  type WorkArenaSuite,
  runWorkArenaBridge,
} from "./workarena-adapter-lib.js";

function parseArgs(): {
  suite: WorkArenaSuite;
  category: string | null;
  json: boolean;
  limit: number;
} {
  const args = process.argv.slice(2);
  const suiteArg = args[args.indexOf("--suite") + 1] as WorkArenaSuite | undefined;
  const categoryArg = args[args.indexOf("--category") + 1];
  const limitArg = Number.parseInt(args[args.indexOf("--limit") + 1] ?? "", 10);
  const suite: WorkArenaSuite =
    suiteArg && ["all", "atomic", "l1", "l2", "l3"].includes(suiteArg)
      ? suiteArg
      : "all";

  return {
    suite,
    category: categoryArg && !categoryArg.startsWith("--") ? categoryArg : null,
    json: args.includes("--json"),
    limit: Number.isFinite(limitArg) && limitArg >= 0 ? limitArg : 30,
  };
}

function runList(): ListResult {
  const args = parseArgs();
  const bridgeArgs = ["list", "--suite", args.suite];
  if (args.category) bridgeArgs.push("--category", args.category);
  return runWorkArenaBridge<ListResult>(bridgeArgs);
}

function printHuman(result: ListResult, limit: number): void {
  console.log("\n[workarena:list] WorkArena tasks");
  console.log(`[workarena:list] Suite: ${result.suite}`);
  console.log(`[workarena:list] Count: ${result.count}`);
  console.log("");

  if (result.categories.length > 0) {
    console.log("[workarena:list] Categories:");
    for (const category of result.categories) {
      console.log(`[workarena:list]   - ${category.category}: ${category.count}`);
    }
    console.log("");
  }

  const shown = result.tasks.slice(0, limit);
  console.log(`[workarena:list] Tasks${limit === 0 ? "" : ` (first ${shown.length})`}:`);
  for (const task of shown) {
    const category = task.category ?? "uncategorized";
    const seed = task.seed === null ? "" : ` seed=${task.seed}`;
    console.log(
      `[workarena:list]   - ${task.id} | ${task.kind} | ${category}${seed}`,
    );
  }

  if (result.tasks.length > shown.length) {
    console.log(
      `[workarena:list]   ... ${result.tasks.length - shown.length} more; use --json for full metadata or --limit N for more rows.`,
    );
  }
}

function main(): void {
  const args = parseArgs();
  const result = runList();
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printHuman(result, args.limit);
}

main();
