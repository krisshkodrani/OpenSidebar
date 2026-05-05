import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, relative, sep } from "path";
import { fileURLToPath } from "url";
import { describe, expect, test } from "vitest";

const SIDE_PANEL_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/sidepanel",
);

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) return listSourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

describe("RFC-012 sidepanel runtime boundary", () => {
  test("keeps direct chrome API usage isolated to the runtime port", () => {
    const offenders = listSourceFiles(SIDE_PANEL_SRC)
      .filter((file) => !file.endsWith(`${sep}runtime.ts`))
      .filter((file) => /\bchrome\./.test(readFileSync(file, "utf8")))
      .map((file) => relative(SIDE_PANEL_SRC, file).replace(/\\/g, "/"));

    expect(offenders).toEqual([]);
  });
});
