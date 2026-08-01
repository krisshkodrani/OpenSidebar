/** Install, verify, or remove the local observability MCP in Codex. */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

const command = process.argv[2] ?? "doctor";
const repositoryRoot = resolve(process.cwd());
const serverName = "opensidebar-observability";

function codexInvocation(): { executable: string; prefix: string[] } {
  if (process.platform !== "win32") {
    return { executable: "codex", prefix: [] };
  }
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const nativeCli = join(directory, "codex.exe");
    if (existsSync(nativeCli)) return { executable: nativeCli, prefix: [] };
    const cli = join(
      directory,
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );
    if (existsSync(cli)) return { executable: process.execPath, prefix: [cli] };
  }
  throw new Error("Codex CLI was not found on PATH.");
}

function runCodex(args: string[], quiet = false) {
  const invocation = codexInvocation();
  return spawnSync(invocation.executable, [...invocation.prefix, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: quiet ? "pipe" : "inherit",
    shell: false,
  });
}

function install(): void {
  runCodex(["mcp", "remove", serverName], true);
  const result = runCodex([
    "mcp",
    "add",
    serverName,
    "--",
    process.execPath,
    "--import",
    "tsx",
    join(repositoryRoot, "scripts", "obs", "mcp-server.ts"),
  ]);
  if (result.status !== 0) throw new Error("Codex MCP registration failed");
  console.log(`Installed ${serverName}. Restart Codex to load its tools.`);
}

function doctor(): void {
  const result = runCodex(["mcp", "get", serverName], true);
  if (result.status !== 0) {
    console.error(`FAIL Codex MCP registration missing: ${serverName}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK   Codex MCP registration: ${serverName}`);
  console.log("INFO run 'pnpm run mcp:smoke' to verify trace access");
}

function uninstall(): void {
  const result = runCodex(["mcp", "remove", serverName]);
  if (result.status !== 0) throw new Error("Codex MCP removal failed");
  console.log(`Removed ${serverName}.`);
}

if (command === "install") install();
else if (command === "doctor") doctor();
else if (command === "uninstall") uninstall();
else throw new Error(`Unknown lifecycle command: ${command}`);
