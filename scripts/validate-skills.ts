import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

type JsonRecord = Record<string, unknown>;

const repoRoot = process.cwd();
const skillsRoot = join(repoRoot, "skills", "workflow");
const allowedMaturity = new Set(["draft", "candidate", "active"]);
const allowedVerifierMode = new Set(["deterministic", "hybrid", "llm"]);
const allowedMemoryScope = new Set(["turn", "workspace"]);

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function formatPath(path: string): string {
  return relative(repoRoot, path).replace(/\\/g, "/");
}

function readDescriptor(path: string): JsonRecord {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
  } catch (error) {
    throw new Error(`${formatPath(path)} is not valid JSON: ${String(error)}`);
  }
}

function requireString(
  descriptor: JsonRecord,
  field: string,
  errors: string[],
  descriptorPath: string,
): string | null {
  const value = descriptor[field];
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  errors.push(
    `${formatPath(descriptorPath)} must define a non-empty string "${field}"`,
  );
  return null;
}

function validateDescriptor(
  skillDir: string,
  seenIds: Set<string>,
  errors: string[],
) {
  const descriptorPath = join(skillDir, "descriptor.json");
  const skillPath = join(skillDir, "SKILL.md");

  if (!existsSync(descriptorPath)) {
    errors.push(`${formatPath(skillDir)} is missing descriptor.json`);
    return;
  }

  if (!existsSync(skillPath)) {
    errors.push(`${formatPath(skillDir)} is missing SKILL.md`);
  } else {
    const markdown = readFileSync(skillPath, "utf8").trim();
    if (!markdown.startsWith("# ")) {
      errors.push(`${formatPath(skillPath)} must start with an H1 title`);
    }
  }

  const descriptor = readDescriptor(descriptorPath);
  const id = requireString(descriptor, "id", errors, descriptorPath);
  requireString(descriptor, "name", errors, descriptorPath);
  requireString(descriptor, "description", errors, descriptorPath);

  if (id) {
    const dirName = skillDir.split(/[\\/]/).at(-1);
    if (id !== dirName) {
      errors.push(
        `${formatPath(descriptorPath)} id "${id}" must match directory "${dirName}"`,
      );
    }
    if (seenIds.has(id)) {
      errors.push(`${formatPath(descriptorPath)} duplicates skill id "${id}"`);
    }
    seenIds.add(id);
  }

  for (const field of ["tags", "triggers"]) {
    if (
      !isStringArray(descriptor[field]) ||
      (descriptor[field] as string[]).length === 0
    ) {
      errors.push(
        `${formatPath(descriptorPath)} must define a non-empty string array "${field}"`,
      );
    }
  }

  for (const field of ["preferredTools", "discouragedTools", "notes"]) {
    if (descriptor[field] !== undefined && !isStringArray(descriptor[field])) {
      errors.push(
        `${formatPath(descriptorPath)} optional "${field}" must be a string array`,
      );
    }
  }

  const maturity = descriptor.maturity;
  if (typeof maturity !== "string" || !allowedMaturity.has(maturity)) {
    errors.push(
      `${formatPath(descriptorPath)} maturity must be one of ${[...allowedMaturity].join(", ")}`,
    );
  }

  const verifierMode = descriptor.verifierMode;
  if (
    typeof verifierMode !== "string" ||
    !allowedVerifierMode.has(verifierMode)
  ) {
    errors.push(
      `${formatPath(descriptorPath)} verifierMode must be one of ${[
        ...allowedVerifierMode,
      ].join(", ")}`,
    );
  }

  const memoryScope = descriptor.memoryScope ?? descriptor.contextScope;
  if (
    memoryScope !== undefined &&
    (typeof memoryScope !== "string" || !allowedMemoryScope.has(memoryScope))
  ) {
    errors.push(
      `${formatPath(descriptorPath)} memoryScope/contextScope must be one of ${[
        ...allowedMemoryScope,
      ].join(", ")}`,
    );
  }
}

function main() {
  if (!existsSync(skillsRoot)) {
    throw new Error(`${formatPath(skillsRoot)} does not exist`);
  }

  const errors: string[] = [];
  const seenIds = new Set<string>();
  const skillDirs = readdirSync(skillsRoot)
    .map((entry) => join(skillsRoot, entry))
    .filter((path) => statSync(path).isDirectory())
    .sort();

  if (skillDirs.length === 0) {
    errors.push(
      `${formatPath(skillsRoot)} does not contain any workflow skill directories`,
    );
  }

  for (const skillDir of skillDirs) {
    validateDescriptor(skillDir, seenIds, errors);
  }

  if (errors.length > 0) {
    console.error("[skills:validate] Found skill descriptor issues:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `[skills:validate] Validated ${skillDirs.length} workflow skills.`,
  );
}

main();
