import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

interface BridgeConfig {
  version: 1;
  port: number;
  authToken: string;
  repositoryRoot: string;
  pairingCode: string;
}

const command = process.argv[2] ?? "doctor";
const repositoryRoot = resolve(process.cwd());
const configRoot =
  process.platform === "win32"
    ? join(
        process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
        "OpenSidebar",
      )
    : join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
        "opensidebar",
      );
const configPath = join(configRoot, "codex-browser-bridge.json");
const serverName = "opensidebar-browser";

function codexInvocation(): { executable: string; prefix: string[] } {
  if (process.platform !== "win32") {
    return { executable: "codex", prefix: [] };
  }
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const nativeCli = join(directory, "codex.exe");
    if (existsSync(nativeCli)) {
      return { executable: nativeCli, prefix: [] };
    }
    const cli = join(
      directory,
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );
    if (existsSync(cli)) {
      return { executable: process.execPath, prefix: [cli] };
    }
  }
  throw new Error(
    "Codex CLI was not found on PATH. Install or update Codex, then retry.",
  );
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

async function loadConfig(): Promise<BridgeConfig | null> {
  try {
    return JSON.parse(await readFile(configPath, "utf8")) as BridgeConfig;
  } catch {
    return null;
  }
}

async function install(): Promise<void> {
  const requestedPort = Number(process.env.BROWSER_MCP_WS_PORT ?? 8787);
  if (
    !Number.isInteger(requestedPort) ||
    requestedPort < 1 ||
    requestedPort > 65_535
  ) {
    throw new Error("BROWSER_MCP_WS_PORT must be an integer from 1 to 65535");
  }
  const existing = await loadConfig();
  const authToken = existing?.authToken ?? randomBytes(32).toString("base64url");
  const config: BridgeConfig = {
    version: 1,
    port: requestedPort,
    authToken,
    repositoryRoot,
    pairingCode: `${requestedPort}:${authToken}`,
  };
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(configPath, 0o600).catch(() => {});

  runCodex(["mcp", "remove", serverName], true);
  const added = runCodex([
    "mcp",
    "add",
    serverName,
    "--env",
    `BROWSER_MCP_WS_PORT=${config.port}`,
    "--env",
    `BROWSER_MCP_AUTH_TOKEN=${config.authToken}`,
    "--",
    "corepack",
    "pnpm",
    "--dir",
    repositoryRoot,
    "mcp:browser",
  ]);
  if (added.status !== 0) {
    throw new Error("Codex MCP registration failed");
  }
  console.log(`\nInstalled ${serverName}.`);
  console.log(`Protected config: ${configPath}`);
  console.log("\nIn OpenSidebar: Settings → Advanced settings → Codex browser bridge");
  console.log(`Pairing code: ${config.pairingCode}`);
  console.log("\nRestart Codex after pairing, then run: pnpm bridge:doctor");
}

async function doctor(): Promise<void> {
  const config = await loadConfig();
  let failed = false;
  if (!config) {
    console.error(`FAIL config missing: ${configPath}`);
    failed = true;
  } else {
    console.log(`OK   config: ${configPath}`);
    console.log(
      config.authToken.length >= 32
        ? "OK   authentication token length"
        : "FAIL authentication token is too short",
    );
    if (config.authToken.length < 32) failed = true;
    console.log(`INFO bridge endpoint: ws://127.0.0.1:${config.port}`);
  }
  const registered = runCodex(["mcp", "get", serverName], true);
  if (registered.status === 0) {
    console.log(`OK   Codex MCP registration: ${serverName}`);
  } else {
    console.error(`FAIL Codex MCP registration missing: ${serverName}`);
    failed = true;
  }
  console.log(
    "INFO extension pairing is intentionally verified in OpenSidebar Settings; the token is never read back by this process.",
  );
  if (failed) process.exitCode = 1;
}

async function uninstall(): Promise<void> {
  runCodex(["mcp", "remove", serverName], true);
  await rm(configPath, { force: true });
  console.log(`Removed Codex MCP registration ${serverName}.`);
  console.log(`Removed local bridge config ${configPath}.`);
  console.log(
    "OpenSidebar keeps its paired token until you click Disconnect in Settings.",
  );
}

switch (command) {
  case "install":
    await install();
    break;
  case "doctor":
    await doctor();
    break;
  case "uninstall":
    await uninstall();
    break;
  default:
    throw new Error(`Unknown lifecycle command: ${command}`);
}
