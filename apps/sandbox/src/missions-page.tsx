import { useState } from "react";
import { Badge, Box, Button, Flex, Heading, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RemoteMissionV1 } from "@opensidebar/shared-types";
import { accountApi } from "./account-api";
import { AppShell } from "./app/AppShell";
import { PageHeader, PageLayout, card } from "./app/page-ui";

const active = new Set(["queued", "accepted", "running", "target_selection_required", "supervision_required", "approval_required"]);
const statusText: Record<RemoteMissionV1["state"], string> = {
  queued: "Waiting for browser",
  accepted: "Starting",
  running: "Running",
  target_selection_required: "Choose a tab in the extension",
  supervision_required: "Waiting for Codex",
  approval_required: "Waiting for local approval",
  succeeded: "Completed",
  failed: "Could not complete",
  cancelled: "Stopped",
  outcome_unknown: "Outcome uncertain",
};

export function MissionsPage() {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmStopId, setConfirmStopId] = useState<string | null>(null);
  const setup = useQuery({
    queryKey: ["remote-work-setup"],
    queryFn: async () => {
      const [devices, credentials, remoteWork, missions] = await Promise.all([
        accountApi.devices(), accountApi.credentials(), accountApi.remoteWork(), accountApi.remoteMissions(),
      ]);
      return { devices, credentials, remoteWork, missions };
    },
    retry: false,
    refetchInterval: 10_000,
  });
  const detail = useQuery({
    queryKey: ["remote-mission", selectedId],
    queryFn: () => accountApi.remoteMission(selectedId!),
    enabled: Boolean(selectedId && setup.data?.missions.enabled),
    refetchInterval: selectedId ? 10_000 : false,
  });
  const stop = useMutation({
    mutationFn: accountApi.cancelRemoteMission,
    onSuccess: async () => {
      setConfirmStopId(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["remote-work-setup"] }),
        client.invalidateQueries({ queryKey: ["remote-mission"] }),
      ]);
    },
  });
  const data = setup.data;
  const browsers = data?.devices.filter((device) =>
    device.connectionKind === "browser_extension" && !device.revokedAt) ?? [];
  const readyBrowser = browsers.some((device) =>
    device.availability === "online" && device.capabilities.includes("remote_browser_tasks_v1"));
  const codexConnected = data?.devices.some((device) =>
    device.connectionKind === "codex_integration" && !device.revokedAt) ?? false;
  const keyReady = data?.credentials.some((credential) =>
    credential.configured && credential.verification === "valid") ?? false;
  const steps = [
    { label: "Link the Chrome extension", ready: browsers.length > 0, detail: "Install OpenSidebar, sign in, and link this browser." },
    { label: "Connect a provider key", ready: keyReady, detail: "Add and verify your own model key in Settings." },
    { label: "Keep a capable browser online", ready: readyBrowser, detail: "OpenSidebar must be signed in and polling on a recent build." },
    { label: "Enable remote work", ready: data?.remoteWork.enabled ?? false, detail: "You can turn this off at any time in Settings." },
    { label: "Connect Codex", ready: codexConnected, detail: "Add https://opensidebar.com/mcp in Codex and complete sign-in." },
  ];

  return <AppShell><PageLayout>
    <PageHeader title="Remote work" description="Let Codex supervise read-only browser tasks on a browser you select. You stay in control of access and can stop work here or in the extension." />
    {setup.isPending ? <Text role="status">Checking your connections…</Text> : null}
    {setup.error ? <Box {...card} role="alert"><Heading size="md">Connections unavailable</Heading>
      <Text mt="2">{setup.error instanceof Error ? setup.error.message : "Please try again."}</Text>
      <Button asChild mt="4"><a href="/app/sign-in">Sign in</a></Button></Box> : null}
    {data ? <Stack gap="7">
      <Box {...card} borderLeftWidth="3px" borderLeftColor="accent">
        <Flex justify="space-between" align="start" gap="4" wrap="wrap">
          <Box><Heading size="md">Ready for remote work</Heading>
            <Text color="muted" mt="2">The first beta supports research and extraction. Browser edits and submissions are unavailable.</Text></Box>
          <Badge colorPalette={data.missions.enabled && steps.every((step) => step.ready) ? "green" : "gray"}>
            {data.missions.enabled ? steps.every((step) => step.ready) ? "Ready" : "Setup needed" : "Beta unavailable"}
          </Badge>
        </Flex>
        {!data.missions.enabled ? <Text mt="3" role="status">Remote missions are currently available only to enabled beta accounts.</Text> : null}
      </Box>
      <Box><Flex justify="space-between" align="center" gap="3" wrap="wrap" mb="4">
        <Box><Heading size="lg">Connection readiness</Heading><Text color="muted" mt="1">Each requirement reflects a current connection, not mission progress.</Text></Box><Button asChild variant="outline"><a href="/app/settings">Open settings</a></Button>
      </Flex>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="3">
          {steps.map((step) => <Box {...card} key={step.label}>
            <Flex justify="space-between" gap="3"><Heading size="sm">{step.label}</Heading>
              <Badge colorPalette={step.ready ? "green" : "gray"}>{step.ready ? "Done" : "To do"}</Badge></Flex>
            <Text color="muted" mt="2">{step.detail}</Text>
          </Box>)}
        </SimpleGrid>
      </Box>
      <Box><Heading size="lg" mb="4">Recent missions</Heading>
        {!data.missions.missions.length ? <Box {...card}><Text color="muted">No remote missions yet. Start a read-only task from Codex after setup.</Text></Box> :
          <Stack gap="3">{data.missions.missions.map((mission) =>
            <Box {...card} key={mission.missionId}>
              <Flex align="center" justify="space-between" gap="4" wrap="wrap">
                <Box><Flex align="center" gap="3" wrap="wrap"><Heading size="sm">Mission {mission.missionId.slice(0, 8)}</Heading>
                  <Badge colorPalette={mission.state === "succeeded" ? "green" : mission.state === "outcome_unknown" ? "orange" : "gray"}>{statusText[mission.state]}</Badge></Flex>
                  <Text color="muted" mt="1">Started {new Date(mission.createdAt).toLocaleString()} · {mission.updatedAt ? `State observed ${new Date(mission.updatedAt).toLocaleString()} · ` : ""}Browser {browsers.find((device) => device.id === mission.deviceId)?.displayName ?? "unavailable"}</Text></Box>
                <Flex gap="2"><Button variant="outline" onClick={() => setSelectedId(mission.missionId)}>Details</Button>
                  {active.has(mission.state) ? <Button variant="outline" colorPalette="red" onClick={() => setConfirmStopId(mission.missionId)}>Stop</Button> : null}</Flex>
              </Flex>
              {confirmStopId === mission.missionId ? <Box mt="4" p="4" bg="surfaceMuted" borderRadius="control">
                <Text>Stop this mission? Work already performed in the browser cannot be undone.</Text>
                <Flex gap="2" mt="3"><Button colorPalette="red" disabled={stop.isPending} onClick={() => stop.mutate(mission.missionId)}>Stop mission</Button>
                  <Button variant="outline" onClick={() => setConfirmStopId(null)}>Keep running</Button></Flex>
              </Box> : null}
            </Box>)}</Stack>}
      </Box>
      {selectedId ? <Box {...card} aria-live="polite"><Flex justify="space-between" gap="3"><Heading size="md">Mission details</Heading>
        <Button variant="ghost" onClick={() => setSelectedId(null)}>Close</Button></Flex>
        {detail.isPending ? <Text mt="3">Loading…</Text> : detail.error ? <Text mt="3" role="alert">Could not load this mission. Refresh and try again.</Text> :
          <Stack gap="2" mt="3"><Text>Status: {statusText[detail.data!.mission.state]}</Text>
            {detail.data?.result?.summary ? <Text>{detail.data.result.summary}</Text> : <Text color="muted">The result will appear here when the mission finishes.</Text>}</Stack>}
      </Box> : null}
      {stop.error ? <Text role="alert" color="danger">{stop.error instanceof Error ? stop.error.message : "Could not stop the mission."}</Text> : null}
    </Stack> : null}
  </PageLayout></AppShell>;
}
