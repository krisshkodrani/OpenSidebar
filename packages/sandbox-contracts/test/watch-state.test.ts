import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_THRESHOLD_DEFAULT_STATE,
  DATA_TABLE_DEFAULT_STATE,
  EMAIL_COMPOSE_DEFAULT_STATE,
  MESSAGE_WATCH_DEFAULT_STATE,
  ONLINE_PURCHASE_DEFAULT_STATE,
  PRICE_WATCH_DEFAULT_STATE,
  REGISTRATION_DEFAULT_STATE,
  ARTICLE_RESEARCH_DEFAULT_STATE,
  reduceTaskState,
  reduceWatchState,
} from "../src/index.ts";

test("price watch crosses its target only when triggered", () => {
  const armed = reduceWatchState("price-watch", PRICE_WATCH_DEFAULT_STATE, { type: "scenario.arm", delaySeconds: 30 });
  assert.equal(armed.lifecycle, "armed");
  const triggered = reduceWatchState("price-watch", armed.state, { type: "scenario.trigger" });
  assert.ok((triggered.state as typeof PRICE_WATCH_DEFAULT_STATE).priceCents < PRICE_WATCH_DEFAULT_STATE.targetPriceCents);
});

test("action and research scenarios expose a controllable feasible target", () => {
  const purchase = reduceTaskState("online-purchase", { ...ONLINE_PURCHASE_DEFAULT_STATE, checkoutAvailable: false }, { type: "scenario.trigger" });
  assert.equal((purchase.state as typeof ONLINE_PURCHASE_DEFAULT_STATE).checkoutAvailable, true);
  const email = reduceTaskState("email-compose", { ...EMAIL_COMPOSE_DEFAULT_STATE, recipientAvailable: false }, { type: "scenario.trigger" });
  assert.equal((email.state as typeof EMAIL_COMPOSE_DEFAULT_STATE).recipientAvailable, true);
  const table = reduceTaskState("data-table", DATA_TABLE_DEFAULT_STATE, { type: "scenario.trigger" });
  assert.equal((table.state as typeof DATA_TABLE_DEFAULT_STATE).recordStatus, "Ready");
  const article = reduceTaskState("article-research", { ...ARTICLE_RESEARCH_DEFAULT_STATE, keyFindingVisible: false }, { type: "scenario.trigger" });
  assert.equal((article.state as typeof ARTICLE_RESEARCH_DEFAULT_STATE).keyFindingVisible, true);
});

test("a permanently impossible action remains unavailable", () => {
  const result = reduceTaskState("online-purchase", { ...ONLINE_PURCHASE_DEFAULT_STATE, feasibility: "permanently_impossible", checkoutAvailable: false }, { type: "scenario.trigger" });
  assert.equal((result.state as typeof ONLINE_PURCHASE_DEFAULT_STATE).checkoutAvailable, false);
  assert.equal(result.result, "quiet_correct");
});

test("dashboard watch raises the incident metric past its threshold", () => {
  const triggered = reduceWatchState("dashboard-threshold", DASHBOARD_THRESHOLD_DEFAULT_STATE, { type: "scenario.trigger" });
  assert.ok((triggered.state as typeof DASHBOARD_THRESHOLD_DEFAULT_STATE).value > DASHBOARD_THRESHOLD_DEFAULT_STATE.threshold);
});

test("message watch appends a perceptible priority-one incident", () => {
  const triggered = reduceWatchState("message-watch", MESSAGE_WATCH_DEFAULT_STATE, { type: "scenario.trigger" });
  assert.equal((triggered.state as typeof MESSAGE_WATCH_DEFAULT_STATE).messages.at(-1)?.priority, "P1");
});

test("message watch can emit an irrelevant non-P1 update", () => {
  const configured = reduceWatchState("message-watch", MESSAGE_WATCH_DEFAULT_STATE, { type: "watch.setRelevant", relevant: false });
  const triggered = reduceWatchState("message-watch", configured.state, { type: "scenario.trigger" });
  assert.equal((triggered.state as typeof MESSAGE_WATCH_DEFAULT_STATE).messages.at(-1)?.priority, "P2");
});

test("registration opens with seats after trigger and stays closed when impossible", () => {
  const opened = reduceWatchState("registration", REGISTRATION_DEFAULT_STATE, { type: "scenario.trigger" });
  assert.equal((opened.state as typeof REGISTRATION_DEFAULT_STATE).registrationOpen, true);
  const blocked = reduceWatchState("registration", { ...REGISTRATION_DEFAULT_STATE, feasibility: "permanently_impossible" }, { type: "scenario.trigger" });
  assert.equal((blocked.state as typeof REGISTRATION_DEFAULT_STATE).registrationOpen, false);
  assert.equal(blocked.result, "quiet_correct");
});
