import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DASHBOARD_THRESHOLD_DEFAULT_STATE,
  MESSAGE_WATCH_DEFAULT_STATE,
  PRICE_WATCH_DEFAULT_STATE,
  REGISTRATION_DEFAULT_STATE,
  RESTOCK_DEFAULT_STATE,
  defaultState,
  reduceRestockState,
  reduceTaskState,
  reduceWatchState,
  scenarios,
  type SandboxControlCommand,
  type SandboxRun,
  type ScenarioDefinition,
} from "@sandbox-contracts";
import { loadTargetRun, submitTargetAction } from "./target-api";
import { controlApi } from "./control-api";
import { ControlProviders } from "./app/control-providers";
import "./styles.css";
import "./guide.css";
import { AccountPage } from "./account";
import { DashboardPage } from "./dashboard";
import { AppShell } from "./app/AppShell";
import { ViewerPage } from "./viewer";

// The control-session cookie is intentionally host-only. Keep the Control
// Center on its canonical host so a visit through www cannot create a separate
// browser session that the apex API cannot use.
if (window.location.hostname === "www.opensidebar.com") {
  window.location.replace(
    `https://opensidebar.com${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
}

const legacyAppRoutes: Record<string, string> = {
  "/dashboard": "/app",
  "/dashboard/activation": "/app/internal/activation",
  "/sessions": "/app/sessions",
  "/account": "/app/account",
  "/settings": "/app/settings",
  "/playground": "/app/playground",
  "/viewer": "/app/viewer",
};
if (legacyAppRoutes[location.pathname]) {
  location.replace(
    `${legacyAppRoutes[location.pathname]}${location.search}${location.hash}`,
  );
}

const enabled = new Set([
  "restock-alert",
  "price-watch",
  "dashboard-threshold",
  "message-watch",
  "registration",
  "online-purchase",
  "email-compose",
  "data-table",
  "article-research",
]);
const now = () => new Date().toISOString();
const future = () => new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
const definition = (id: string) => scenarios.find((item) => item.id === id)!;
const taskScenarios = [
  "online-purchase",
  "email-compose",
  "data-table",
  "article-research",
] as const;
const isTaskScenario = (
  id: SandboxRun["scenarioId"],
): id is (typeof taskScenarios)[number] =>
  taskScenarios.includes(id as (typeof taskScenarios)[number]);
function localRun(scenarioId: SandboxRun["scenarioId"]): SandboxRun {
  return {
    id: `r_${crypto.randomUUID().slice(0, 8)}`,
    scenarioId,
    scenarioVersion: 1,
    lifecycle: "ready",
    revision: 1,
    state: defaultState(scenarioId),
    createdAt: now(),
    updatedAt: now(),
    expiresAt: future(),
    result: null,
  };
}

function useRuns() {
  const remote = !import.meta.env.DEV;
  const [localRuns, setLocalRuns] = useState<SandboxRun[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem("opensidebar:sandbox:runs") ?? "[]",
      );
    } catch {
      return [];
    }
  });
  const queryClient = useQueryClient();
  const runsQuery = useQuery({
    queryKey: ["playground", "runs"],
    queryFn: controlApi.listRuns,
    enabled: remote,
    refetchInterval: remote ? 1_000 : false,
  });
  const runs = remote ? (runsQuery.data ?? []) : localRuns;
  const setRuns = (update: (current: SandboxRun[]) => SandboxRun[]) => {
    if (remote)
      queryClient.setQueryData<SandboxRun[]>(
        ["playground", "runs"],
        (current) => update(current ?? []),
      );
    else setLocalRuns(update);
  };
  useEffect(() => {
    if (!remote)
      localStorage.setItem("opensidebar:sandbox:runs", JSON.stringify(runs));
  }, [remote, runs]);
  useEffect(() => {
    if (remote) return;
    const timer = window.setInterval(
      () =>
        setRuns((items) =>
          items.map((run) => {
            const state = run.state as { transitionAt?: string | null };
            if (
              !state.transitionAt ||
              Date.parse(state.transitionAt) > Date.now()
            )
              return run;
            const next =
              run.scenarioId === "restock-alert"
                ? reduceRestockState(
                    run.state as typeof RESTOCK_DEFAULT_STATE,
                    { type: "scenario.trigger" },
                  )
                : isTaskScenario(run.scenarioId)
                  ? reduceTaskState(run.scenarioId, run.state, {
                      type: "scenario.trigger",
                    })
                  : reduceWatchState(
                      run.scenarioId as Exclude<
                        SandboxRun["scenarioId"],
                        "restock-alert"
                      >,
                      run.state,
                      { type: "scenario.trigger" },
                    );
            return {
              ...run,
              ...next,
              revision: run.revision + 1,
              updatedAt: now(),
              result: next.result ?? run.result,
            };
          }),
        ),
      500,
    );
    return () => clearInterval(timer);
  }, [remote]);
  const create = async (scenarioId: SandboxRun["scenarioId"]) => {
    if (remote) {
      const run = await controlApi.createRun(scenarioId);
      setRuns((all) =>
        all.some((item) => item.id === run.id) ? all : [...all, run],
      );
      return run.id;
    }
    if (runs.length >= 3) return null;
    const run = localRun(scenarioId);
    setRuns((all) => [...all, run]);
    return run.id;
  };
  const command = async (id: string, cmd: SandboxControlCommand) => {
    if (remote) {
      const next = await controlApi.command(id, cmd);
      setRuns((all) => all.map((run) => (run.id === id ? next : run)));
      return;
    }
    setRuns((all) =>
      all.map((run) => {
        if (run.id !== id) return run;
        const next =
          run.scenarioId === "restock-alert"
            ? reduceRestockState(
                run.state as typeof RESTOCK_DEFAULT_STATE,
                cmd as never,
              )
            : isTaskScenario(run.scenarioId)
              ? reduceTaskState(run.scenarioId, run.state, cmd as never)
              : reduceWatchState(
                  run.scenarioId as Exclude<
                    SandboxRun["scenarioId"],
                    "restock-alert"
                  >,
                  run.state,
                  cmd as never,
                );
        return {
          ...run,
          ...next,
          revision: run.revision + 1,
          updatedAt: now(),
          result: next.result ?? run.result,
        };
      }),
    );
  };
  const remove = async (id: string) => {
    if (remote) {
      await controlApi.remove(id);
      setRuns((all) => all.filter((run) => run.id !== id));
      return;
    }
    setRuns((all) => all.filter((run) => run.id !== id));
  };
  return { runs, create, command, remove, remote };
}

function ScenarioCard({
  scenario,
  onStart,
  starting,
}: {
  scenario: ScenarioDefinition;
  onStart: () => void;
  starting: boolean;
}) {
  const available = enabled.has(scenario.id);
  return (
    <article className="card scenario-card">
      <span className="eyebrow">{scenario.category}</span>
      <h2>{scenario.title}</h2>
      <p>{scenario.description}</p>
      <div className="meta">
        <span>{scenario.difficulty}</span>
        <span>{scenario.duration}</span>
      </div>
      <button
        className="btn btn-primary"
        disabled={!available || starting}
        onClick={onStart}
      >
        {starting ? "Starting…" : available ? "Start scenario" : "Coming soon"}
      </button>
    </article>
  );
}

const controlSteps = [
  {
    title: "Sign in and choose a scenario",
    body: "Open the Control Center, sign in with your email code, and start one of the available scenarios.",
  },
  {
    title: "Prepare the hidden conditions",
    body: "Set the target state, timing, relevance, or challenge mode. These controls are never shown to the agent.",
  },
  {
    title: "Open the isolated target",
    body: "Select Open target. A separate play.opensidebar.com tab opens with a short-lived session for this run.",
  },
  {
    title: "Give OpenSidebar the task",
    body: "Copy the suggested task, open OpenSidebar on the target tab, and start it there. Keep the Control Center separate.",
  },
  {
    title: "Change conditions and observe",
    body: "Return to the Control Center to trigger changes or blockers, then see whether the agent acts, waits, or asks for help.",
  },
] as const;

const targetSteps = [
  {
    title: "Start in the Control Center",
    body: "Go to opensidebar.com/playground. This page is the target room; scenarios are created in the private control room.",
  },
  {
    title: "Sign in and select a scenario",
    body: "Use your email code, choose a scenario, and prepare its initial state without exposing those controls to the agent.",
  },
  {
    title: "Select Open target",
    body: "The Control Center creates a short-lived launch link and opens the scenario here in a separate tab.",
  },
  {
    title: "Run OpenSidebar here",
    body: "Give OpenSidebar the suggested task on the target tab. It sees only the simulated site, not the hidden controls.",
  },
  {
    title: "Vary the scenario from the other tab",
    body: "Trigger a change, add a blocker, or make the task impossible in the Control Center and observe how the agent responds.",
  },
] as const;

function SandboxGuide({ surface }: { surface: "control" | "target" }) {
  const steps = surface === "control" ? controlSteps : targetSteps;
  return (
    <section className="guide" aria-labelledby={`${surface}-guide-title`}>
      <div className="guide-heading">
        <div>
          <span className="eyebrow">Step by step</span>
          <h2 id={`${surface}-guide-title`}>How to use the Playground</h2>
        </div>
        <p>
          <strong>Two separate rooms:</strong> you operate the private Control
          Center; the agent operates only the target site.
        </p>
      </div>
      <ol className="step-list">
        {steps.map((step, index) => (
          <li className="step" key={step.title}>
            <span className="step-number">{index + 1}</span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TargetLanding() {
  return (
    <main className="empty target-landing">
      <span className="eyebrow">OpenSidebar Playground · Target site</span>
      <h1>This is the agent&apos;s side of the Playground.</h1>
      <p>
        A scenario appears here only after you create it in the private Control
        Center. OpenSidebar can interact with this target, but it cannot see the
        controls used to change the scenario.
      </p>
      <div className="landing-actions">
        <a
          className="btn btn-primary"
          href="https://opensidebar.com/playground"
        >
          Open Control Center
        </a>
        <a
          className="btn btn-ghost"
          href="https://opensidebar.com/ideas/the-sandbox-needs-two-rooms"
        >
          Read the design idea
        </a>
      </div>
      <SandboxGuide surface="target" />
    </main>
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!email.trim()) {
      setMessage("Enter your email address.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await controlApi.requestCode(email);
      setChallengeId(result.challengeId);
      setMessage(
        "Check your inbox or spam folder for the sign-in code. It expires in 10 minutes.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not send a code.");
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    if (!challengeId) return;
    if (!/^\d{6,8}$/.test(code)) {
      setMessage("Enter the 6 to 8 digit code from your email.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await controlApi.verifyCode(challengeId, email, code);
      location.assign("/playground");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "That code did not work.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="empty signin-shell">
      <span className="eyebrow">
        OpenSidebar Playground · Private Control Center
      </span>
      <h1>
        {challengeId
          ? "Enter your one-time code."
          : "Set up the room behind the experiment."}
      </h1>
      <p>
        We’ll send a one-time code. No password is created or stored in this
        app.
      </p>
      <label>
        Email{" "}
        <input
          type="email"
          value={email}
          autoComplete="email"
          placeholder="you@company.com"
          disabled={Boolean(challengeId) || busy}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      {challengeId && (
        <label>
          Sign-in code{" "}
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6,8}"
            placeholder="Enter code"
            value={code}
            disabled={busy}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, "").slice(0, 8))
            }
            required
          />
        </label>
      )}
      {message && (
        <p className="signin-message" role="status">
          {message}
        </p>
      )}
      <div className="actions">
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void (challengeId ? verify() : send())}
        >
          {busy
            ? "Working…"
            : challengeId
              ? "Verify and enter Playground"
              : "Send sign-in code"}
        </button>
        {challengeId && (
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => {
              setChallengeId(null);
              setCode("");
              setMessage("Enter your email to request a new code.");
            }}
          >
            Use another email or request a new code
          </button>
        )}
        <a className="btn btn-ghost" href="/playground">
          Back to Playground
        </a>
      </div>
    </main>
  );
}

function visibleSummary(run: SandboxRun) {
  const s = run.state as Record<string, unknown>;
  if (run.scenarioId === "restock-alert")
    return (
      <>
        Availability:{" "}
        {s.availability === "in_stock" ? "In stock" : "Out of stock"}
        <br />
        Inventory: {String(s.inventory)}
        <br />
        Price: ${(Number(s.priceCents) / 100).toFixed(2)}
      </>
    );
  if (run.scenarioId === "price-watch")
    return (
      <>
        Current price: ${(Number(s.priceCents) / 100).toFixed(2)}
        <br />
        Alert threshold: ${(Number(s.targetPriceCents) / 100).toFixed(2)}
      </>
    );
  if (run.scenarioId === "dashboard-threshold")
    return (
      <>
        {String(s.metric)}: {String(s.value)}
        <br />
        Alert threshold: {String(s.threshold)}
      </>
    );
  if (run.scenarioId === "message-watch")
    return (
      <>
        Messages in feed: {(s.messages as unknown[]).length}
        <br />
        Trigger adds a priority-one incident.
      </>
    );
  if (run.scenarioId === "online-purchase")
    return (
      <>
        Checkout: {s.checkoutAvailable ? "Available" : "Unavailable"}
        <br />
        Coupon: {String(s.coupon ?? "None")}
      </>
    );
  if (run.scenarioId === "email-compose")
    return (
      <>
        Recipient: {s.recipientAvailable ? "Available" : "Unavailable"}
        <br />
        Source message from {String(s.sender)}
      </>
    );
  if (run.scenarioId === "data-table")
    return (
      <>
        Record: {String(s.recordName)}
        <br />
        Updates: {s.updatesAllowed ? "Allowed" : "Blocked"}
      </>
    );
  if (run.scenarioId === "article-research")
    return (
      <>
        Evidence: {s.keyFindingVisible ? "Visible" : "Withheld"}
        <br />
        Article: {String(s.title)}
      </>
    );
  return (
    <>
      Registration: {s.registrationOpen ? "Open" : "Closed"}
      <br />
      Seats: {String(s.seatsRemaining)}
    </>
  );
}

function ControlCenter() {
  const { runs, create, command, remove, remote } = useRuns();
  const [selected, setSelected] = useState<string | null>(null);
  const [creatingRun, setCreatingRun] = useState(false);
  const [delay, setDelay] = useState(30);
  const [startingScenario, setStartingScenario] = useState<
    SandboxRun["scenarioId"] | null
  >(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [activity, setActivity] = useState<
    Array<{ id: string; message: string; time: string }>
  >([]);
  const [launching, setLaunching] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [authenticated, setAuthenticated] = useState(!remote);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  useEffect(() => {
    if (!remote) return;
    let alive = true;
    void controlApi
      .session()
      .then((session) => {
        if (!alive) return;
        setAuthenticated(session.authenticated);
        setSignedInEmail(session.email ?? null);
      })
      .catch(() => {
        if (alive) {
          setAuthenticated(false);
          setSignedInEmail(null);
        }
      });
    return () => {
      alive = false;
    };
  }, [remote]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const run = runs.find((item) => item.id === selected) ?? runs[0] ?? null;
  const observedRevision = useRef<Record<string, number>>({});
  const report = (message: string) => {
    setActionFeedback(message);
    setActivity((items) =>
      [
        {
          id: crypto.randomUUID(),
          message,
          time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        },
        ...items,
      ].slice(0, 6),
    );
  };
  useEffect(() => {
    if (run && selected !== run.id) setSelected(run.id);
  }, [run, selected]);
  useEffect(() => {
    if (!run) return;
    const previous = observedRevision.current[run.id];
    observedRevision.current[run.id] = run.revision;
    if (previous !== undefined && previous !== run.revision) {
      setActivity((items) =>
        [
          {
            id: crypto.randomUUID(),
            message: `Target synchronized · revision ${run.revision} · ${run.lifecycle}`,
            time: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
          },
          ...items,
        ].slice(0, 6),
      );
    }
  }, [run]);
  const start = async (id: SandboxRun["scenarioId"]) => {
    setStartingScenario(id);
    setStartError(null);
    try {
      const created = await create(id);
      if (created) {
        setSelected(created);
        setCreatingRun(false);
      } else
        setStartError("You can have up to three active scenarios at a time.");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Playground could not start this scenario.";
      if (message === "Sign in to use Playground.") {
        controlApi.login();
        return;
      }
      setStartError(message);
    } finally {
      setStartingScenario(null);
    }
  };
  const open = async () => {
    if (!run) return;
    if (import.meta.env.DEV) {
      window.open(`/run/${run.id}`, "_blank", "noopener");
      return;
    }
    const target = window.open("about:blank", "_blank");
    if (!target) {
      report(
        "Your browser blocked the target tab. Allow pop-ups for opensidebar.com and try again.",
      );
      return;
    }
    setLaunching(true);
    report("Preparing the isolated target tab…");
    try {
      const launchUrl = await controlApi.launch(run.id);
      target.location.assign(launchUrl);
      report("Target opened in a separate tab.");
    } catch (error) {
      target.close();
      report(
        error instanceof Error ? error.message : "Could not open the target.",
      );
    } finally {
      setLaunching(false);
    }
  };
  if (!run || creatingRun)
    return (
      <main className="empty">
        <span className="eyebrow">OpenSidebar Playground</span>
        <h1>
          {creatingRun
            ? "Choose a new scenario."
            : "Try your browser agent in a safe, realistic environment."}
        </h1>
        <p>
          {creatingRun
            ? "Create a separate run with its own hidden controls and target session."
            : "You control the change; OpenSidebar sees only the target page."}
        </p>
        {!remote && <p className="muted">Local playground mode</p>}
        {remote && !authenticated && (
          <button className="btn btn-ghost" onClick={controlApi.login}>
            Sign in with email
          </button>
        )}
        {remote && authenticated && (
          <p className="notice">
            Signed in as <strong>{signedInEmail ?? "your email"}</strong>. Your
            Playground access is available across all scenarios for 90 days.
          </p>
        )}
        {startError && (
          <p className="notice" role="alert">
            {startError}
          </p>
        )}
        {!creatingRun && <SandboxGuide surface="control" />}
        <section className="catalog">
          <h2>Scenarios</h2>
          <div className="grid">
            {scenarios.map((scenario) => (
              <ScenarioCard
                key={scenario.id}
                scenario={scenario}
                onStart={() => void start(scenario.id)}
                starting={startingScenario === scenario.id}
              />
            ))}
          </div>
        </section>
        {creatingRun && (
          <button
            className="btn btn-ghost"
            onClick={() => setCreatingRun(false)}
          >
            Back to active run
          </button>
        )}
      </main>
    );
  const state = run.state as Record<string, unknown>;
  const feasibility = state.feasibility as string | undefined;
  const isTask = isTaskScenario(run.scenarioId);
  const runCommand = async (cmd: SandboxControlCommand, success?: string) => {
    try {
      await command(run.id, cmd);
      report(success ?? "Control updated. The target is synchronizing now.");
    } catch (error) {
      report(
        error instanceof Error
          ? error.message
          : "Could not update the scenario.",
      );
    }
  };
  const setValue = (value: number) =>
    runCommand(
      run.scenarioId === "restock-alert"
        ? { type: "restock.setInventory", inventory: value }
        : isTask
          ? { type: "task.setAvailable", available: value > 0 }
          : { type: "watch.setValue", value },
    );
  const setFeasibility = (value: string) =>
    runCommand(
      run.scenarioId === "restock-alert"
        ? { type: "restock.setFeasibility", feasibility: value as never }
        : isTask
          ? { type: "task.setFeasibility", feasibility: value as never }
          : { type: "watch.setFeasibility", feasibility: value as never },
    );
  const transitionAt =
    typeof state.transitionAt === "string" ? state.transitionAt : null;
  const remainingSeconds = transitionAt
    ? Math.max(0, Math.ceil((Date.parse(transitionAt) - clock) / 1000))
    : null;
  const armCountdown = async () => {
    report(`Arming a ${delay}-second countdown…`);
    try {
      await command(run.id, { type: "scenario.arm", delaySeconds: delay });
      setClock(Date.now());
      report(`Countdown active. The target changes in ${delay} seconds.`);
    } catch (error) {
      report(
        error instanceof Error
          ? error.message
          : "Could not start the countdown.",
      );
    }
  };
  const triggerNow = async () => {
    report("Triggering the scenario now…");
    try {
      await command(run.id, { type: "scenario.trigger" });
      report("Scenario triggered. The target has been updated.");
    } catch (error) {
      report(
        error instanceof Error
          ? error.message
          : "Could not trigger the scenario.",
      );
    }
  };
  const deleteRun = async () => {
    try {
      await remove(run.id);
      setActionFeedback(null);
    } catch (error) {
      report(
        error instanceof Error ? error.message : "Could not delete the run.",
      );
    }
  };
  return (
    <main className="workspace">
      <aside>
        <a className="brand" href="/">
          OpenSidebar <small>Playground</small>
        </a>
        <button
          className="new-run"
          disabled={runs.length >= 3}
          onClick={() => setCreatingRun(true)}
        >
          + New run
        </button>
        <p className="side-label">ACTIVE RUNS · {runs.length}/3</p>
        {runs.map((item) => (
          <button
            className={`run-item ${item.id === run.id ? "selected" : ""}`}
            onClick={() => setSelected(item.id)}
            key={item.id}
          >
            <span className="dot" />
            {definition(item.scenarioId).title}
            <small>{item.lifecycle}</small>
          </button>
        ))}
      </aside>
      <section className="controls">
        <header>
          <div>
            <span className="eyebrow">Control Center</span>
            <h1>{definition(run.scenarioId).title}</h1>
          </div>
          <div className="status">
            <span className="dot" /> {run.lifecycle}
          </div>
        </header>
        <div className="notice">
          <strong>Private controls.</strong> These settings are never rendered
          or disclosed in the target page.
        </div>
        {actionFeedback && (
          <div className="notice" role="status">
            {actionFeedback}
          </div>
        )}
        <section className="activity-panel" aria-label="Live activity">
          <div className="activity-heading">
            <strong>Live activity</strong>
            <span>
              <i /> Connected
            </span>
          </div>
          {activity.length ? (
            activity.map((item) => (
              <div className="activity-item" key={item.id}>
                <time>{item.time}</time>
                <span>{item.message}</span>
              </div>
            ))
          ) : (
            <p className="muted">
              Actions, target synchronization, and countdown events will appear
              here.
            </p>
          )}
        </section>
        <SandboxGuide surface="control" />
        <div className="control-grid">
          <section className="card">
            <h2>Current target state</h2>
            <p>{visibleSummary(run)}</p>
          </section>
          <section className="card">
            <h2>Trigger</h2>
            <label>
              Countdown{" "}
              <select
                value={delay}
                onChange={(e) => setDelay(Number(e.target.value))}
              >
                {[15, 30, 60, 120].map((v) => (
                  <option key={v} value={v}>
                    {v} seconds
                  </option>
                ))}
              </select>
            </label>
            <div className="actions">
              <button
                className="btn btn-ghost"
                onClick={() => void armCountdown()}
              >
                {remainingSeconds && remainingSeconds > 0
                  ? `${remainingSeconds}s remaining`
                  : "Start countdown"}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void triggerNow()}
              >
                Trigger now
              </button>
            </div>
          </section>
          {feasibility && (
            <section className="card">
              <h2>Challenge mode</h2>
              <label>
                Feasibility{" "}
                <select
                  value={feasibility}
                  onChange={(e) => setFeasibility(e.target.value)}
                >
                  <option value="feasible">Feasible after trigger</option>
                  <option value="temporarily_blocked">
                    Temporarily blocked
                  </option>
                  <option value="recoverable">Recoverable</option>
                  <option value="permanently_impossible">Never happens</option>
                </select>
              </label>
              {isTask ? (
                <label>
                  Target available
                  <input
                    type="checkbox"
                    checked={Boolean(
                      state.checkoutAvailable ??
                      state.recipientAvailable ??
                      state.updatesAllowed ??
                      state.keyFindingVisible,
                    )}
                    onChange={(e) => setValue(e.target.checked ? 1 : 0)}
                  />
                </label>
              ) : (
                run.scenarioId !== "message-watch" && (
                  <label>
                    Override value
                    <input
                      type="number"
                      value={
                        run.scenarioId === "price-watch"
                          ? Number(state.priceCents)
                          : run.scenarioId === "dashboard-threshold"
                            ? Number(state.value)
                            : run.scenarioId === "registration"
                              ? Number(state.seatsRemaining)
                              : Number(state.inventory)
                      }
                      onChange={(e) => setValue(Number(e.target.value))}
                    />
                  </label>
                )
              )}
              {run.scenarioId === "message-watch" && (
                <label>
                  Next message
                  <select
                    value={String(state.nextMessagePriority)}
                    onChange={(e) =>
                      void runCommand({
                        type: "watch.setRelevant",
                        relevant: e.target.value === "P1",
                      })
                    }
                  >
                    <option value="P1">Relevant P1 incident</option>
                    <option value="P2">Irrelevant P2 update</option>
                  </select>
                </label>
              )}
              {run.scenarioId === "restock-alert" && (
                <>
                  <label>
                    Change relevance
                    <select
                      value={String(state.relevance)}
                      onChange={(e) =>
                        void runCommand({
                          type: "restock.setRelevance",
                          relevance: e.target.value as
                            | "relevant"
                            | "decorative",
                        })
                      }
                    >
                      <option value="relevant">Relevant restock</option>
                      <option value="decorative">Decorative only</option>
                    </select>
                  </label>
                  <label>
                    Visual-only update
                    <input
                      type="checkbox"
                      checked={Boolean(state.visualOnly)}
                      onChange={(e) =>
                        void runCommand({
                          type: "restock.setVisualOnly",
                          visualOnly: e.target.checked,
                        })
                      }
                    />
                  </label>
                </>
              )}
            </section>
          )}
          <section className="card">
            <h2>Try it with OpenSidebar</h2>
            <p>
              Open the target, start the suggested task, then arm or trigger the
              change.
            </p>
            <div className="actions">
              <button
                className="btn btn-primary"
                disabled={launching}
                onClick={() => void open()}
              >
                {launching ? "Opening…" : "Open target"}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(definition(run.scenarioId).suggestedTasks[0])
                    .then(
                      () => report("Task copied to the clipboard."),
                      () =>
                        report(
                          "Could not copy the task. Select and copy it manually.",
                        ),
                    )
                }
              >
                Copy task
              </button>
            </div>
          </section>
        </div>
        <footer>
          <button className="link-danger" onClick={() => void deleteRun()}>
            Delete run
          </button>
          <button
            className="btn btn-ghost"
            onClick={() =>
              void runCommand(
                { type: "scenario.reset" },
                "Scenario reset to its clean starting state.",
              )
            }
          >
            Reset with clean state
          </button>
        </footer>
      </section>
    </main>
  );
}

function Target() {
  const id = location.pathname.split("/").pop() ?? "";
  const [run, setRun] = useState<SandboxRun | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [shoeSize, setShoeSize] = useState("US 10");
  const [shoeQuantity, setShoeQuantity] = useState(1);
  const [targetFeedback, setTargetFeedback] = useState<string | null>(null);
  const [addingToCart, setAddingToCart] = useState(false);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const next = await loadTargetRun();
        if (alive) setRun(next as unknown as SandboxRun);
      } catch {
        if (!import.meta.env.DEV) {
          if (alive) setUnavailable(true);
          return;
        }
        try {
          const runs = JSON.parse(
            localStorage.getItem("opensidebar:sandbox:runs") ?? "[]",
          ) as SandboxRun[];
          if (alive) setRun(runs.find((item) => item.id === id) ?? null);
        } catch {
          /* no-op */
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id]);
  if (unavailable || !run)
    return (
      <main className="store target-expired">
        <h1>That Playground session has ended.</h1>
        <p>Return to OpenSidebar Playground to create a fresh run.</p>
      </main>
    );
  const s = run.state as Record<string, unknown>;
  if (run.scenarioId === "online-purchase")
    return (
      <main className="store">
        <header className="store-nav">
          <b>Peak Outfitters</b>
          <small>Demo checkout — no payment</small>
        </header>
        <section className="product">
          <p className="crumb">Cart / Checkout</p>
          <h1>Nimbus Running Shoe</h1>
          <p className="price">${(Number(s.priceCents) / 100).toFixed(2)}</p>
          <p>
            Coupon available: <b>{String(s.coupon ?? "None")}</b>
          </p>
          <p className={`availability ${s.checkoutAvailable ? "in" : "out"}`}>
            {s.checkoutAvailable
              ? `${String(s.inventory)} in stock`
              : "Checkout is temporarily unavailable"}
          </p>
          <label>
            Size{" "}
            <select>
              <option>US 10</option>
            </select>
          </label>
          <button
            className="add"
            disabled={!s.checkoutAvailable || s.orderPlaced === true}
            onClick={() =>
              void submitTargetAction("purchase.placeOrder").then((next) =>
                setRun(next as unknown as SandboxRun),
              )
            }
          >
            {s.orderPlaced ? "Order placed" : "Place demo order"}
          </button>
        </section>
      </main>
    );
  if (run.scenarioId === "email-compose")
    return (
      <main className="store">
        <header className="store-nav">
          <b>Northstar Mail</b>
          <small>Demo mailbox</small>
        </header>
        <section className="product">
          <p className="crumb">Inbox / Latest</p>
          <h1>{String(s.subject)}</h1>
          <article className="card">
            <p>
              <b>{String(s.sender)}</b>
            </p>
            <p>{String(s.sourceMessage)}</p>
          </article>
          <label>
            To{" "}
            <input
              value={s.recipientAvailable ? "maya.chen@northstar.example" : ""}
              readOnly
            />
          </label>
          <label>
            Reply{" "}
            <textarea defaultValue="Hi Maya, the rollout is on track for the next milestone." />
          </label>
          <button
            className="add"
            disabled={!s.recipientAvailable || s.emailSent === true}
            onClick={() =>
              void submitTargetAction("email.send").then((next) =>
                setRun(next as unknown as SandboxRun),
              )
            }
          >
            {s.emailSent ? "Reply sent" : "Send demo reply"}
          </button>
        </section>
      </main>
    );
  if (run.scenarioId === "data-table")
    return (
      <main className="store">
        <header className="store-nav">
          <b>Northstar CRM</b>
          <small>Demo records</small>
        </header>
        <section className="product">
          <p className="crumb">Accounts / Renewals</p>
          <h1>Renewal queue</h1>
          <article className="card">
            <h2>{String(s.recordName)}</h2>
            <p>
              Status: <b>{String(s.recordStatus)}</b>
            </p>
            <label>
              Status{" "}
              <select defaultValue={String(s.recordStatus)}>
                <option>Needs review</option>
                <option>Ready</option>
              </select>
            </label>
            <button
              className="add"
              disabled={!s.updatesAllowed || s.updateSaved === true}
              onClick={() =>
                void submitTargetAction("table.update").then((next) =>
                  setRun(next as unknown as SandboxRun),
                )
              }
            >
              {s.updateSaved ? "Update saved" : "Save update"}
            </button>
          </article>
        </section>
      </main>
    );
  if (run.scenarioId === "article-research")
    return (
      <main className="store">
        <header className="store-nav">
          <b>OpenSidebar Journal</b>
          <small>Research library</small>
        </header>
        <article className="product">
          <p className="crumb">Research / Operations</p>
          <h1>{String(s.title)}</h1>
          <p>
            Automation can reduce repetitive work, but the strongest outcomes
            pair it with deliberate review points and clear ownership.
          </p>
          {s.keyFindingVisible ? (
            <>
              <h2>Key finding</h2>
              <p>{String(s.keyFinding)}</p>
            </>
          ) : (
            <p className="muted">
              The study’s methodology appendix is temporarily unavailable.
            </p>
          )}
          <p>Source: OpenSidebar Journal, Volume 4.</p>
        </article>
      </main>
    );
  if (run.scenarioId === "price-watch")
    return (
      <main className="store">
        <header className="store-nav">
          <b>Peak Outfitters</b>
          <small>Demo store</small>
        </header>
        <section className="product">
          <div className="product-image">👟</div>
          <div>
            <p className="crumb">Running / Shoes</p>
            <h1>Nimbus Running Shoe</h1>
            <p className="price">${(Number(s.priceCents) / 100).toFixed(2)}</p>
            <p className="availability in">Available today</p>
            <p className="description">
              Lightweight daily trainer in Slate Blue.
            </p>
          </div>
        </section>
      </main>
    );
  if (run.scenarioId === "dashboard-threshold")
    return (
      <main className="store">
        <header className="store-nav">
          <b>Pulse Operations</b>
          <small>Live service dashboard</small>
        </header>
        <section className="product">
          <p className="crumb">Operations / Incidents</p>
          <h1>Service health</h1>
          <article className="card">
            <span className="eyebrow">Current metric</span>
            <h2>{String(s.metric)}</h2>
            <p className="price">{String(s.value)}</p>
            <p className="muted">Updated just now</p>
          </article>
        </section>
      </main>
    );
  if (run.scenarioId === "message-watch")
    return (
      <main className="store">
        <header className="store-nav">
          <b>Northstar Support</b>
          <small>Team inbox</small>
        </header>
        <section className="product">
          <p className="crumb">Inbox / All messages</p>
          <h1>Support feed</h1>
          {(
            s.messages as {
              id: string;
              sender: string;
              subject: string;
              priority: string;
              body: string;
            }[]
          ).map((m) => (
            <article className="card" key={m.id}>
              <span className="eyebrow">{m.priority}</span>
              <h2>{m.subject}</h2>
              <p>
                <b>{m.sender}</b> · {m.body}
              </p>
            </article>
          ))}
        </section>
      </main>
    );
  if (run.scenarioId === "registration")
    return (
      <main className="store">
        <header className="store-nav">
          <b>OpenSidebar Events</b>
          <small>Demo registration</small>
        </header>
        <section className="product">
          <p className="crumb">Events / Workshops</p>
          <h1>{String(s.event)}</h1>
          <p className={`availability ${s.registrationOpen ? "in" : "out"}`}>
            {s.registrationOpen
              ? `${String(s.seatsRemaining)} seats available`
              : "Registration is currently closed"}
          </p>
          <button
            className="add"
            disabled={!s.registrationOpen || s.registered === true}
            onClick={() =>
              void submitTargetAction("registration.submit").then((next) =>
                setRun(next as unknown as SandboxRun),
              )
            }
          >
            {s.registered ? "Registered" : "Register"}
          </button>
        </section>
      </main>
    );
  const inStock = s.availability === "in_stock";
  const maxQuantity = Math.max(1, Math.min(5, Number(s.inventory) || 1));
  const addToCart = async () => {
    setAddingToCart(true);
    setTargetFeedback(null);
    try {
      const next = await submitTargetAction("restock.addToCart", {
        size: shoeSize,
        quantity: shoeQuantity,
      });
      setRun(next as unknown as SandboxRun);
      setTargetFeedback(
        `${shoeQuantity} pair${shoeQuantity === 1 ? "" : "s"} in ${shoeSize} added to your demo cart.`,
      );
    } catch (error) {
      setTargetFeedback(
        error instanceof Error
          ? error.message
          : "Could not add this item to the cart.",
      );
    } finally {
      setAddingToCart(false);
    }
  };
  return (
    <main className="store">
      <header className="store-nav">
        <b>Peak Outfitters</b>
        <small>Demo store — no real purchase</small>
      </header>
      <section className="product">
        <div className="product-image">👟</div>
        <div>
          <p className="crumb">Running / Shoes / Daily trainers</p>
          <h1>Nimbus Running Shoe</h1>
          {s.decoration === "featured" && (
            <p className="muted">Featured in this week’s running edit</p>
          )}
          <p className="price">${(Number(s.priceCents) / 100).toFixed(2)}</p>
          <div className={`availability ${inStock ? "in" : "out"}`}>
            {inStock ? `${String(s.inventory)} in stock` : "Out of stock"}
          </div>
          <div className="product-options">
            <label>
              Size
              <select
                value={shoeSize}
                disabled={!inStock}
                onChange={(event) => setShoeSize(event.target.value)}
              >
                {[7, 8, 9, 10, 11, 12].map((size) => (
                  <option key={size}>US {size}</option>
                ))}
              </select>
            </label>
            <label>
              Quantity
              <select
                value={shoeQuantity}
                disabled={!inStock}
                onChange={(event) =>
                  setShoeQuantity(Number(event.target.value))
                }
              >
                {Array.from(
                  { length: maxQuantity },
                  (_, index) => index + 1,
                ).map((quantity) => (
                  <option key={quantity}>{quantity}</option>
                ))}
              </select>
            </label>
          </div>
          {Number(s.cartQuantity) > 0 && (
            <div className="cart-summary">
              <strong>Cart · {String(s.cartQuantity)}</strong>
              <span>
                {String(s.cartSize)} · Demo subtotal $
                {(
                  (Number(s.priceCents) * Number(s.cartQuantity)) /
                  100
                ).toFixed(2)}
              </span>
            </div>
          )}
          {targetFeedback && (
            <p className="target-feedback" role="status">
              {targetFeedback}
            </p>
          )}
          <button
            className="add"
            disabled={!inStock || addingToCart}
            onClick={() => void addToCart()}
          >
            {addingToCart ? "Adding…" : "Add to cart"}
          </button>
        </div>
      </section>
    </main>
  );
}
function App() {
  return location.pathname === "/app" ||
    location.pathname === "/app/internal/activation" ||
    location.pathname === "/app/sessions" ? (
    <DashboardPage />
  ) : location.pathname === "/app/account" ||
    location.pathname === "/app/settings" ? (
    <AccountPage />
  ) : location.pathname === "/app/sign-in" ? (
    <AppShell>
      <SignIn />
    </AppShell>
  ) : location.pathname === "/app/playground" ? (
    <AppShell>
      <ControlCenter />
    </AppShell>
  ) : location.pathname === "/app/viewer" ? (
    <ViewerPage />
  ) : location.pathname.startsWith("/run/") ? (
    <Target />
  ) : !import.meta.env.DEV && location.pathname === "/" ? (
    <TargetLanding />
  ) : new URLSearchParams(location.search).has("auth") ? (
    <SignIn />
  ) : (
    <ControlCenter />
  );
}
const isTargetSurface =
  location.pathname.startsWith("/run/") ||
  (!import.meta.env.DEV && location.pathname === "/");
createRoot(document.getElementById("root")!).render(
  isTargetSurface ? (
    <App />
  ) : (
    <ControlProviders>
      <App />
    </ControlProviders>
  ),
);
