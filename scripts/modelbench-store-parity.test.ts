import assert from "node:assert/strict";
import test from "node:test";
import { MemoryScenarioStore } from "@opensidebar/scenario-engine";
import { compareScenarioStores, definitionsForSuite } from "./modelbench-store-parity.js";

test("identical scenario store implementations have full oracle parity", async () => {
  let index = 0;
  const mismatches = await compareScenarioStores({
    local: new MemoryScenarioStore(),
    remote: new MemoryScenarioStore(),
    definitions: definitionsForSuite("full-100"),
    id: () => String(++index),
  });
  assert.deepEqual(mismatches, []);
  assert.equal(index, 100);
});
