import { PageLayout, PageHeader, card } from "./app/page-ui";
import { useState } from "react";
import {
  Box,
  Badge,
  Button,
  Flex,
  Heading,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PlaygroundRunV2,
  PlaygroundScenarioV2,
} from "@opensidebar/scenario-contracts";
import { controlApi, request } from "./control-api";

const api = <T,>(path: string, init?: RequestInit) =>
  request<T>(path, init, "/api/v2/playground");

export function PlaygroundPage() {
  const client = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const session = useQuery({
    queryKey: ["playground-session"],
    queryFn: controlApi.session,
  });
  const signedIn = session.data?.authenticated === true;
  const catalog = useQuery({
    queryKey: ["playground-v2-catalog"],
    queryFn: () =>
      api<{ enabled: boolean; scenarios: PlaygroundScenarioV2[] }>(
        "/scenarios",
      ),
    enabled: signedIn,
    retry: false,
  });
  const runs = useQuery({
    queryKey: ["playground-v2-runs"],
    queryFn: () => api<{ runs: PlaygroundRunV2[] }>("/runs"),
    enabled: signedIn && catalog.data?.enabled === true,
    refetchInterval: 5000,
  });
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["playground-v2-runs"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function launch(id: string) {
    // Reserve the tab during the click so browsers do not block the async launch.
    const tab = window.open("about:blank", "_blank");
    if (!tab) {
      setError("Allow pop-ups to open the simulated application.");
      return;
    }
    tab.opener = null;
    void act(async () => {
      try {
        const { launchUrl } = await api<{ launchUrl: string }>(
          `/runs/${encodeURIComponent(id)}/launch`,
          { method: "POST" },
        );
        tab.location.replace(launchUrl);
      } catch (cause) {
        tab.close();
        throw cause;
      }
    });
  }
  const failure =
    error ||
    session.error?.message ||
    catalog.error?.message ||
    runs.error?.message;
  return (
    <PageLayout>
      <Stack gap="6">
        <PageHeader
          title="Playground"
          description="Build confidence with 12 realistic browser tasks, powered by ModelBench."
        />
        <Box {...card} p="5" borderLeftWidth="3px" borderLeftColor="accent">
          <Heading size="md">
            Choose a task. Open the app. Let your agent try.
          </Heading>
          <Text mt="2" color="muted">
            Create a private run, copy its task, then open the simulated
            application. Runs expire after two hours. Your prompts, answers and
            traces are not collected.
          </Text>
        </Box>
        {failure && (
          <Text role="alert" color="danger">
            {failure}
          </Text>
        )}
        {notice && <Text role="status">{notice}</Text>}
        {session.isPending && (
          <Text role="status">Loading your Playground…</Text>
        )}
        {session.isSuccess && !signedIn && (
          <Box {...card}>
            <Text mb="3">Sign in to create a private practice run.</Text>
            <Button onClick={() => location.assign("/app/sign-in")}>
              Sign in
            </Button>
          </Box>
        )}
        {signedIn && catalog.isPending && (
          <Text role="status">Loading scenarios…</Text>
        )}
        {catalog.data && !catalog.data.enabled && (
          <Text role="status">
            Playground scenarios are being updated. Please try again later.
          </Text>
        )}
        {catalog.data?.enabled && (
          <>
            <Box id="your-runs" tabIndex={-1}>
              <Heading size="lg" mb="3">
                Your runs
              </Heading>
              <Stack gap="3">
                {runs.isPending && <Text>Loading runs…</Text>}
                {runs.data?.runs.length === 0 && (
                  <Text color="muted">Choose a scenario below to start.</Text>
                )}
                {runs.data?.runs.map((run) => {
                  const scenario = catalog.data.scenarios.find(
                    (item) => item.id === run.scenarioId,
                  );
                  return (
                    <Box {...card} key={run.id}>
                      <Flex justify="space-between" gap="4" flexWrap="wrap">
                        <Box>
                          <Heading size="md">
                            {scenario?.title ?? run.scenarioId}
                          </Heading>
                          <Text color="muted">
                            {scenario?.observationOnly
                              ? "Read-only practice · answers not graded"
                              : run.result === "succeeded"
                                ? "Page objective completed"
                                : run.lifecycle === "finished"
                                  ? "Page objective not completed"
                                  : "Ready to practice"}{" "}
                            · Expires{" "}
                            {new Date(run.expiresAt).toLocaleTimeString()}
                          </Text>
                        </Box>
                        <Flex gap="2" wrap="wrap">
                          <Button
                            disabled={busy}
                            onClick={() => launch(run.id)}
                          >
                            Open application
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy || !scenario}
                            onClick={() =>
                              void act(async () => {
                                if (scenario) {
                                  await navigator.clipboard.writeText(
                                    scenario.task,
                                  );
                                  setNotice(
                                    "Task copied. Paste it into your agent in the application tab.",
                                  );
                                }
                              })
                            }
                          >
                            Copy task
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              void act(async () => {
                                await api(
                                  `/runs/${encodeURIComponent(run.id)}`,
                                  { method: "DELETE" },
                                );
                              })
                            }
                          >
                            Remove
                          </Button>
                        </Flex>
                      </Flex>
                    </Box>
                  );
                })}
              </Stack>
            </Box>
            <Box>
              <Heading size="lg" mb="3">
                Choose a scenario
              </Heading>
              <Flex
                gap="2"
                wrap="wrap"
                mb="4"
                role="group"
                aria-label="Filter scenarios"
              >
                {[
                  ["all", "All tasks"],
                  ["interactive", "Interactive"],
                  ["read", "Read-only practice"],
                ].map(([id, label]) => (
                  <Button
                    key={id}
                    variant={filter === id ? "subtle" : "outline"}
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                  </Button>
                ))}
              </Flex>
              <SimpleGrid columns={{ base: 1, md: 2 }} gap="4">
                {catalog.data.scenarios
                  .filter(
                    (scenario) =>
                      filter === "all" ||
                      (filter === "read"
                        ? scenario.observationOnly
                        : !scenario.observationOnly),
                  )
                  .sort(
                    (a, b) =>
                      Number(b.id === "price-watch") -
                      Number(a.id === "price-watch"),
                  )
                  .map((scenario) => (
                    <Stack {...card} key={scenario.id} gap="3">
                      {scenario.id === "price-watch" && (
                        <Badge colorPalette="blue" alignSelf="start">
                          Recommended first task
                        </Badge>
                      )}
                      <Heading size="md">{scenario.title}</Heading>
                      <Text color="muted" fontSize="sm">
                        {scenario.difficulty} ·{" "}
                        {scenario.observationOnly
                          ? "Read-only practice"
                          : "Interactive task"}
                      </Text>
                      <Text>{scenario.task}</Text>
                      <Flex gap="2" mt="auto" flexWrap="wrap">
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              await api("/runs", {
                                method: "POST",
                                body: JSON.stringify({
                                  scenarioId: scenario.id,
                                }),
                              });
                              requestAnimationFrame(() => {
                                const section =
                                  document.getElementById("your-runs");
                                section?.focus({ preventScroll: true });
                                section?.scrollIntoView({ block: "start" });
                              });
                              setNotice(
                                "Run created. Open the application, then give your agent the suggested task.",
                              );
                            })
                          }
                        >
                          Create run
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              await navigator.clipboard.writeText(
                                scenario.task,
                              );
                              setNotice("Suggested task copied.");
                            })
                          }
                        >
                          Copy task
                        </Button>
                      </Flex>
                    </Stack>
                  ))}
              </SimpleGrid>
            </Box>
          </>
        )}
      </Stack>
    </PageLayout>
  );
}
