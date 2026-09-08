import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Box,
  Button,
  Container,
  Flex,
  Heading,
  Input,
  NativeSelect,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react";
import {
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
import { controlApi } from "./control-api";
import { ControlProviders } from "./app/control-providers";
import { AccountPage } from "./account";
import { DashboardPage } from "./dashboard";
import { AppShell } from "./app/AppShell";
import { ViewerPage } from "./viewer";
import { Notice, PageHeader, SurfaceCard } from "./app/ui";

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
  const runs = useMemo(
    () => (remote ? (runsQuery.data ?? []) : localRuns),
    [localRuns, remote, runsQuery.data],
  );
  const setRuns = useCallback(
    (update: (current: SandboxRun[]) => SandboxRun[]) => {
      if (remote)
        queryClient.setQueryData<SandboxRun[]>(
          ["playground", "runs"],
          (current) => update(current ?? []),
        );
      else setLocalRuns(update);
    },
    [queryClient, remote],
  );
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
  }, [remote, setRuns]);
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
    <SurfaceCard
      as="article"
      display="flex"
      flexDirection="column"
      minH="245px"
    >
      <Text
        color="accent"
        textTransform="uppercase"
        fontSize="xs"
        letterSpacing="wide"
        fontWeight="700"
      >
        {scenario.category}
      </Text>
      <Heading size="md" mt="2">
        {scenario.title}
      </Heading>
      <Text color="muted" mt="3" flex="1">
        {scenario.description}
      </Text>
      <Flex gap="2" my="4">
        <Badge>{scenario.difficulty}</Badge>
        <Badge>{scenario.duration}</Badge>
      </Flex>
      <Button
        colorPalette="blue"
        disabled={!available || starting}
        onClick={onStart}
      >
        {starting ? "Starting…" : available ? "Start scenario" : "Coming soon"}
      </Button>
    </SurfaceCard>
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
    <SurfaceCard
      as="section"
      mt="10"
      aria-labelledby={`${surface}-guide-title`}
    >
      <SimpleGrid columns={{ base: 1, md: 2 }} gap="6" alignItems="end">
        <Box>
          <Text
            color="accent"
            textTransform="uppercase"
            fontSize="xs"
            letterSpacing="wide"
            fontWeight="700"
          >
            How it works
          </Text>
          <Heading id={`${surface}-guide-title`} size="lg" mt="2">
            Three simple steps
          </Heading>
        </Box>
        <Text color="muted">
          <strong>Two separate rooms:</strong> you operate the private Control
          Center; the agent operates only the target site.
        </Text>
      </SimpleGrid>
      <SimpleGrid
        as="ol"
        columns={{ base: 1, md: 3 }}
        gap="3"
        mt="6"
        listStyleType="none"
        p="0"
      >
        {steps.map((step, index) =>
          index < 3 ? (
            <Flex
              as="li"
              key={step.title}
              borderWidth="1px"
              borderColor="line"
              borderRadius="card"
              p="4"
              gap="3"
              align="start"
            >
              <Flex
                flex="0 0 auto"
                w="7"
                h="7"
                borderRadius="full"
                bg="surfaceMuted"
                color="accent"
                align="center"
                justify="center"
                fontWeight="700"
              >
                {index + 1}
              </Flex>
              <Box minW="0">
                <Text fontWeight="700">{step.title}</Text>
                <Text mt="1" color="muted" fontSize="sm">
                  {step.body}
                </Text>
              </Box>
            </Flex>
          ) : null,
        )}
      </SimpleGrid>
    </SurfaceCard>
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
    <Container as="main" maxW="xl" py={{ base: "12", md: "24" }} px="5">
      <SurfaceCard>
        <Text
          color="accent"
          textTransform="uppercase"
          fontSize="xs"
          letterSpacing="wide"
          fontWeight="700"
        >
          OpenSidebar Playground · Control Center
        </Text>
        <Heading size="2xl" mt="3" overflowWrap="anywhere">
          {challengeId
            ? "Enter your one-time code."
            : "Set up the room behind the experiment."}
        </Heading>
        <Text color="muted" mt="3">
          We’ll send a one-time code. No password is created or stored in this
          app.
        </Text>
        <Stack mt="6" gap="4">
          <Box as="label" fontWeight="600">
            <Text mb="2" fontSize="sm">
              Email
            </Text>
            <Input
              type="email"
              value={email}
              autoComplete="email"
              placeholder="you@company.com"
              disabled={Boolean(challengeId) || busy}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Box>
          {challengeId && (
            <Box as="label" fontWeight="600">
              <Text mb="2" fontSize="sm">
                Sign-in code
              </Text>
              <Input
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
            </Box>
          )}
          {message && <Notice>{message}</Notice>}
          <Stack gap="2">
            <Button
              colorPalette="blue"
              disabled={busy}
              onClick={() => void (challengeId ? verify() : send())}
            >
              {busy
                ? "Working…"
                : challengeId
                  ? "Verify and enter Playground"
                  : "Send sign-in code"}
            </Button>
            {challengeId && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setChallengeId(null);
                  setCode("");
                  setMessage("Enter your email to request a new code.");
                }}
              >
                Use another email or request a new code
              </Button>
            )}
            <Button asChild variant="ghost">
              <a href="/app/playground">Back to Playground</a>
            </Button>
          </Stack>
        </Stack>
      </SurfaceCard>
    </Container>
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
      <Container
        as="main"
        maxW="6xl"
        py={{ base: "10", md: "16" }}
        px={{ base: "5", md: "8" }}
      >
        <PageHeader
          eyebrow="OpenSidebar Playground"
          title={
            creatingRun
              ? "Choose a new scenario."
              : "Try your browser agent in a safe, realistic environment."
          }
          description={
            creatingRun
              ? "Create a separate run with its own hidden controls and target session."
              : "You control the conditions in the Control Center. OpenSidebar sees and operates only the isolated target site."
          }
          action={
            remote && !authenticated ? (
              <Button colorPalette="blue" size="lg" onClick={controlApi.login}>
                Sign in with email
              </Button>
            ) : undefined
          }
        />
        {!remote && (
          <Text color="muted" mt="4">
            Local Playground mode
          </Text>
        )}
        {remote && !authenticated && (
          <Text color="muted" mt="4">
            Sign in to create scenarios and control their hidden state.
          </Text>
        )}
        {remote && authenticated && (
          <Box mt="6">
            <Notice>
              Signed in as <strong>{signedInEmail ?? "your email"}</strong>.
              Your Playground access is available across all scenarios for 90
              days.
            </Notice>
          </Box>
        )}
        {startError && (
          <Box mt="6">
            <Notice role="alert" tone="danger">
              {startError}
            </Notice>
          </Box>
        )}
        {!creatingRun && <SandboxGuide surface="control" />}
        <Box as="section" mt={{ base: "12", md: "16" }}>
          <Heading size="lg">Scenarios</Heading>
          <SimpleGrid columns={{ base: 1, sm: 2, xl: 3 }} gap="4" mt="5">
            {scenarios.map((scenario) => (
              <ScenarioCard
                key={scenario.id}
                scenario={scenario}
                onStart={() => void start(scenario.id)}
                starting={startingScenario === scenario.id}
              />
            ))}
          </SimpleGrid>
        </Box>
        {creatingRun && (
          <Button
            mt="6"
            variant="outline"
            onClick={() => setCreatingRun(false)}
          >
            Back to active run
          </Button>
        )}
      </Container>
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
    <Flex
      as="main"
      minH="calc(100vh - 57px)"
      direction={{ base: "column", md: "row" }}
      minW="0"
    >
      <Box
        as="aside"
        w={{ base: "full", md: "240px" }}
        flexShrink="0"
        borderRightWidth={{ md: "1px" }}
        borderBottomWidth={{ base: "1px", md: "0" }}
        borderColor="line"
        bg="surface"
        p="4"
      >
        <Flex align="center" justify="space-between" gap="3">
          <Text fontWeight="700">Active runs · {runs.length}/3</Text>
          <Button
            size="sm"
            variant="outline"
            disabled={runs.length >= 3}
            onClick={() => setCreatingRun(true)}
          >
            New run
          </Button>
        </Flex>
        <Stack
          mt="4"
          gap="1"
          direction={{ base: "row", md: "column" }}
          overflowX={{ base: "auto", md: "visible" }}
        >
          {runs.map((item) => (
            <Button
              variant={item.id === run.id ? "subtle" : "ghost"}
              h="auto"
              minW={{ base: "220px", md: "0" }}
              justifyContent="start"
              textAlign="left"
              py="3"
              onClick={() => setSelected(item.id)}
              key={item.id}
            >
              <Box>
                <Text fontWeight="700">
                  {definition(item.scenarioId).title}
                </Text>
                <Text fontSize="xs" color="fg" fontWeight="600">
                  {item.lifecycle}
                </Text>
              </Box>
            </Button>
          ))}
        </Stack>
      </Box>
      <Container
        as="section"
        maxW="6xl"
        py={{ base: "8", md: "12" }}
        px={{ base: "5", md: "8" }}
        minW="0"
      >
        <PageHeader
          eyebrow="Control Center"
          title={definition(run.scenarioId).title}
          action={<Badge colorPalette="blue">{run.lifecycle}</Badge>}
        />
        <Box mt="6">
          <Notice>
            <strong>Private controls.</strong> These settings are never rendered
            or disclosed in the target page.
          </Notice>
        </Box>
        {actionFeedback && (
          <Box mt="3">
            <Notice>{actionFeedback}</Notice>
          </Box>
        )}
        <SurfaceCard as="section" mt="5" aria-label="Live activity">
          <Flex justify="space-between" align="center">
            <Heading size="sm">Live activity</Heading>
            <Badge colorPalette="green">Connected</Badge>
          </Flex>
          <Stack mt="3" gap="0">
            {activity.length ? (
              activity.map((item) => (
                <Flex
                  key={item.id}
                  gap="3"
                  py="2"
                  borderTopWidth="1px"
                  borderColor="line"
                  fontSize="sm"
                >
                  <Text
                    as="time"
                    color="muted"
                    fontVariantNumeric="tabular-nums"
                  >
                    {item.time}
                  </Text>
                  <Text>{item.message}</Text>
                </Flex>
              ))
            ) : (
              <Text color="muted" fontSize="sm">
                Actions, target synchronization, and countdown events will
                appear here.
              </Text>
            )}
          </Stack>
        </SurfaceCard>
        <SimpleGrid columns={{ base: 1, lg: 2 }} gap="4" mt="5">
          <SurfaceCard>
            <Heading size="md">Current target state</Heading>
            <Text mt="3">{visibleSummary(run)}</Text>
          </SurfaceCard>
          <SurfaceCard>
            <Heading size="md">Trigger</Heading>
            <Box as="label" display="block" mt="4">
              <Text fontSize="sm" mb="1">
                Countdown
              </Text>
              <NativeSelect.Root>
                <NativeSelect.Field
                  value={delay}
                  onChange={(e) => setDelay(Number(e.target.value))}
                >
                  {[15, 30, 60, 120].map((v) => (
                    <option key={v} value={v}>
                      {v} seconds
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Box>
            <Flex gap="2" mt="4" wrap="wrap">
              <Button variant="outline" onClick={() => void armCountdown()}>
                {remainingSeconds && remainingSeconds > 0
                  ? `${remainingSeconds}s remaining`
                  : "Start countdown"}
              </Button>
              <Button colorPalette="blue" onClick={() => void triggerNow()}>
                Trigger now
              </Button>
            </Flex>
          </SurfaceCard>
          {feasibility && (
            <SurfaceCard>
              <Heading size="md">Challenge mode</Heading>
              <Stack mt="4" gap="4">
                <Box as="label">
                  <Text fontSize="sm" mb="1">
                    Feasibility
                  </Text>
                  <NativeSelect.Root>
                    <NativeSelect.Field
                      value={feasibility}
                      onChange={(e) => setFeasibility(e.target.value)}
                    >
                      <option value="feasible">Feasible after trigger</option>
                      <option value="temporarily_blocked">
                        Temporarily blocked
                      </option>
                      <option value="recoverable">Recoverable</option>
                      <option value="permanently_impossible">
                        Never happens
                      </option>
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </Box>
                {isTask ? (
                  <Flex as="label" gap="2" align="center">
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
                    <Text fontSize="sm">Target available</Text>
                  </Flex>
                ) : (
                  run.scenarioId !== "message-watch" && (
                    <Box as="label">
                      <Text fontSize="sm" mb="1">
                        Override value
                      </Text>
                      <Input
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
                    </Box>
                  )
                )}
                {run.scenarioId === "message-watch" && (
                  <Box as="label">
                    <Text fontSize="sm" mb="1">
                      Next message
                    </Text>
                    <NativeSelect.Root>
                      <NativeSelect.Field
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
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  </Box>
                )}
                {run.scenarioId === "restock-alert" && (
                  <>
                    <Box as="label">
                      <Text fontSize="sm" mb="1">
                        Change relevance
                      </Text>
                      <NativeSelect.Root>
                        <NativeSelect.Field
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
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                    </Box>
                    <Flex as="label" gap="2" align="center">
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
                      <Text fontSize="sm">Visual-only update</Text>
                    </Flex>
                  </>
                )}
              </Stack>
            </SurfaceCard>
          )}
          <SurfaceCard>
            <Heading size="md">Try it with OpenSidebar</Heading>
            <Text mt="3" color="muted">
              Open the target, start the suggested task, then arm or trigger the
              change.
            </Text>
            <Flex gap="2" mt="4" wrap="wrap">
              <Button
                colorPalette="blue"
                disabled={launching}
                onClick={() => void open()}
              >
                {launching ? "Opening…" : "Open target"}
              </Button>
              <Button
                variant="outline"
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
              </Button>
            </Flex>
          </SurfaceCard>
        </SimpleGrid>
        <Flex as="footer" justify="space-between" mt="6" gap="3" wrap="wrap">
          <Button
            variant="ghost"
            colorPalette="red"
            onClick={() => void deleteRun()}
          >
            Delete run
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              void runCommand(
                { type: "scenario.reset" },
                "Scenario reset to its clean starting state.",
              )
            }
          >
            Reset with clean state
          </Button>
        </Flex>
      </Container>
    </Flex>
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
  ) : new URLSearchParams(location.search).has("auth") ? (
    <SignIn />
  ) : (
    <ControlCenter />
  );
}
createRoot(document.getElementById("root")!).render(
  <ControlProviders>
    <App />
  </ControlProviders>,
);
