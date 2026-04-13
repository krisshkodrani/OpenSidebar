import { existsSync } from "fs";
import { applyLabEnvironment, GBRAIN_REPO, runCommand } from "./common.js";

applyLabEnvironment();

if (!existsSync(GBRAIN_REPO)) {
  console.error("GBrain submodule is missing. Run: git submodule update --init --recursive lab/agents/gbrain/repo");
  process.exit(1);
}

const exitCode = runCommand(
  "bun",
  ["run", "src/cli.ts", "serve"],
  {
    cwd: GBRAIN_REPO,
    env: {
      ...process.env,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
    },
  },
);

process.exit(exitCode);

