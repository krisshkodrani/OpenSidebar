import { existsSync } from "fs";
import {
  applyLabEnvironment,
  GBRAIN_DB_PATH,
  GBRAIN_REPO,
  PROJECT_ROOT,
  runCommand,
} from "./common.js";

applyLabEnvironment();

if (!existsSync(GBRAIN_REPO)) {
  console.error("GBrain submodule is missing. Run: git submodule update --init --recursive lab/agents/gbrain/repo");
  process.exit(1);
}

const args = process.argv.slice(2);
const command = args[0];
const forwardedArgs =
  command === "init" && !args.includes("--path")
    ? [...args, "--path", GBRAIN_DB_PATH]
    : args;

const exitCode = runCommand(
  "bun",
  ["run", "src/cli.ts", ...forwardedArgs],
  {
    cwd: GBRAIN_REPO,
    env: {
      ...process.env,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
    },
  },
);

if (command === "init" && exitCode === 0) {
  console.log(`\nLab GBrain state is pinned to ${GBRAIN_DB_PATH}`);
  console.log(`Lab config home is pinned to ${PROJECT_ROOT}\\data\\lab-home`);
}

process.exit(exitCode);

