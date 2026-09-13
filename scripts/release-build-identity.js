import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/** Hash relative paths and bytes, independent of checkout path and timestamps. */
export function releaseBuildSha256(directory) {
  const entries = [];
  function visit(relativePath) {
    for (const entry of readdirSync(resolve(directory, relativePath), { withFileTypes: true })) {
      const path = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) entries.push(path);
      else throw new Error(`Unsupported release entry: ${path}`);
    }
  }
  visit("");
  const hash = createHash("sha256");
  for (const path of entries.sort()) {
    const content = readFileSync(resolve(directory, path));
    hash.update(JSON.stringify([path, content.length]));
    hash.update(content);
  }
  return hash.digest("hex");
}

export function matchesProductionSmoke(report, { commit, version, distSha256 }) {
  return Boolean(commit && version && distSha256 &&
    report?.result === "passed" && report.build === "production" &&
    report.commit === commit && report.version === version &&
    report.distSha256 === distSha256 && report.nativePanelRendered === true);
}
