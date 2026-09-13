import assert from "node:assert/strict";
import test from "node:test";
import {
  publicPlaygroundAction,
  publicPlaygroundCase,
  publicPlaygroundCatalog,
  scenarioEngine,
} from "../src/index.js";

test("public catalog reuses twelve shared fixtures without internal control metadata", () => {
  const catalog = publicPlaygroundCatalog();
  assert.equal(catalog.length, 12);
  assert.equal(new Set(catalog.map((item) => item.id)).size, 12);
  for (const item of catalog) {
    assert.deepEqual(Object.keys(item).sort(), [
      "difficulty",
      "family",
      "id",
      "observationOnly",
      "task",
      "title",
      "version",
    ]);
    const definition = publicPlaygroundCase(item.id);
    assert.equal(item.task, definition.contract.prompt);
    assert.ok(
      scenarioEngine.targetView(
        scenarioEngine.initialize(definition.contract.id),
      ),
    );
  }
  for (const id of [
    "__proto__",
    "constructor",
    "acceptance.mb-101-workspace-tab",
    "retail.checkout-multi-item",
  ])
    assert.throws(() => publicPlaygroundCase(id));
});

test("all curated interactive objectives remain achievable through the public action boundary", () => {
  for (const item of publicPlaygroundCatalog()) {
    const definition = publicPlaygroundCase(item.id);
    const initialState = scenarioEngine.initialize(definition.contract.id);
    let state = initialState;
    for (const action of definition.oracle.actions.filter((action) =>
      action.type.startsWith("workflow."),
    )) {
      state = scenarioEngine.apply(
        state,
        publicPlaygroundAction(state, action),
      );
    }
    if (!item.observationOnly) {
      const value = definition.oracle.actions.find(
        (action) => action.payload?.path === "public.case.value",
      )?.payload?.value;
      state = scenarioEngine.apply(
        state,
        publicPlaygroundAction(state, {
          type: "case.submit",
          payload:
            item.id === "price-watch"
              ? { value: String(value) }
              : { decision: "apply" },
        }),
      );
    }
    if (!item.observationOnly)
      assert.equal(
        scenarioEngine.validate({ definition, initialState, finalState: state })
          .verdict,
        "pass",
        item.id,
      );
    for (const payload of [
      { answer: "private answer" },
      { value: "private answer" },
      { decision: "apply", model: "private model" },
    ]) {
      assert.throws(
        () =>
          publicPlaygroundAction(initialState, {
            type: "case.submit",
            payload,
          }),
        item.id,
      );
    }
    assert.throws(() =>
      publicPlaygroundAction(initialState, {
        type: "workflow.recover",
        payload: {},
        trace: "private",
      }),
    );
    assert.throws(() =>
      publicPlaygroundAction(initialState, {
        type: "case.terminal",
        payload: { outcome: "done" },
      }),
    );
  }
});
