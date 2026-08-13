import type { JsonObject } from "./json.js";
import type { BenchmarkPrimaryRole } from "./catalog.js";

export interface RoleProbeV1 {
  schemaVersion: 1;
  id: string;
  version: number;
  role: Exclude<BenchmarkPrimaryRole, "integrated">;
  sourceCaseId: string;
  instruction: string;
  input: JsonObject;
  expected: JsonObject;
  contentHash: string;
}

export interface RoleProbeResultV1 {
  schemaVersion: 1;
  probeId: string;
  probeVersion: number;
  passed: boolean;
  evidence: readonly string[];
}
