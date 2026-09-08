import { spawn } from "node:child_process";

const iterations = Number.parseInt(process.env.SUSTAINED_ITERATIONS ?? "12", 10);
const results: unknown[] = [];
const startedAt = new Date().toISOString();
for (let iteration = 0; iteration < iterations; iteration += 1) {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [new URL("./run-load-fixtures.js", import.meta.url).pathname], { env: process.env, stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(stdout) : reject(new Error(`load_iteration_failed:${code}`)));
  });
  results.push(JSON.parse(output));
}
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, startedAt, finishedAt: new Date().toISOString(), iterations, results }, null, 2)}\n`);
