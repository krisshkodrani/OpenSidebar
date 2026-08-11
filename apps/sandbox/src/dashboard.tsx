import { useState } from "react";
import {
  Badge,
  Box,
  Button,
  Container,
  Flex,
  Heading,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import type { CloudSessionV1 } from "@opensidebar/shared-types";
import { accountApi } from "./account-api";
import { AppShell } from "./app/AppShell";

const card = {
  bg: "surface",
  borderWidth: "1px",
  borderColor: "line",
  borderRadius: "card",
  boxShadow: "card",
} as const;

function StatusCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <Box {...card} p="5">
      <Text color="muted" fontSize="sm">
        {label}
      </Text>
      <Text mt="2" fontWeight="700" fontSize="xl">
        {value}
      </Text>
      <Text mt="1" color="muted" fontSize="sm">
        {note}
      </Text>
    </Box>
  );
}

function Loading() {
  return (
    <Stack gap="4">
      <Skeleton h="24" />
      <Skeleton h="40" />
      <Skeleton h="40" />
    </Stack>
  );
}

function Failure({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "Try again shortly.";
  const signIn = message.toLowerCase().includes("sign in");
  return (
    <Box {...card} p="6" borderColor="danger" role="alert">
      <Heading size="md">Could not load the dashboard</Heading>
      <Text mt="2" color="danger">
        {message}
      </Text>
      <Button
        mt="5"
        colorPalette="blue"
        onClick={() =>
          signIn
            ? location.assign(
                `/api/v1/playground/auth/login?return=${encodeURIComponent(location.pathname)}`,
              )
            : location.reload()
        }
      >
        {signIn ? "Sign in" : "Try again"}
      </Button>
    </Box>
  );
}

function SessionsList({
  sessions,
  select,
}: {
  sessions: CloudSessionV1[];
  select?: (session: CloudSessionV1) => void;
}) {
  if (!sessions.length)
    return (
      <Box {...card} p="8">
        <Heading size="md">No cloud sessions yet</Heading>
        <Text mt="2" color="muted">
          Local sessions remain in the extension. Cloud Sessions have not been
          activated for this account.
        </Text>
      </Box>
    );
  return (
    <Stack gap="3">
      {sessions.map((session) => (
        <Button
          key={session.sessionId}
          variant="plain"
          h="auto"
          p="0"
          textAlign="left"
          onClick={() => select?.(session)}
        >
          <Flex
            {...card}
            p="5"
            w="full"
            justify="space-between"
            align="center"
            gap="4"
            wrap="wrap"
          >
            <Box>
              <Text fontWeight="700">{session.title}</Text>
              <Text color="muted" fontSize="sm">
                Updated {new Date(session.updatedAt).toLocaleString()}
              </Text>
            </Box>
            <Flex gap="3" align="center">
              <Badge
                colorPalette={session.status === "active" ? "green" : "gray"}
              >
                {session.status.replaceAll("_", " ")}
              </Badge>
              <Text fontSize="sm">
                {session.sizeBytes.toLocaleString()} bytes
              </Text>
            </Flex>
          </Flex>
        </Button>
      ))}
    </Stack>
  );
}

function Overview() {
  const query = useQuery({
    queryKey: ["cloud-dashboard"],
    queryFn: accountApi.dashboard,
    retry: false,
  });
  const data = query.data;
  return (
    <AppShell>
      <Container maxW="6xl" py={{ base: "8", md: "12" }}>
        <Flex justify="space-between" align="start" gap="4" wrap="wrap">
          <Box>
            <Text
              color="accent"
              fontWeight="700"
              fontSize="xs"
              letterSpacing="wide"
            >
              OPENSIDEBAR CLOUD
            </Text>
            <Heading size="2xl" mt="2">
              Overview
            </Heading>
            <Text mt="2" color="muted">
              {data?.account.email ?? "Your OpenSidebar workspace"}
            </Text>
          </Box>
          <Badge colorPalette={data?.account.cloudAccess ? "green" : "gray"}>
            {data?.account.cloudAccess ? "Connected" : "Unavailable"}
          </Badge>
        </Flex>
        <Box mt="8">
          {query.isPending ? (
            <Loading />
          ) : query.error || !data ? (
            <Failure error={query.error} />
          ) : (
            <>
              <SimpleGrid columns={{ base: 1, sm: 2, xl: 3 }} gap="4">
                <StatusCard
                  label="Provider"
                  value={
                    data.credentials.find((item) => item.configured)
                      ?.provider ?? "Not configured"
                  }
                  note={
                    data.credentials.some(
                      (item) => item.verification === "valid",
                    )
                      ? "Provider connection verified"
                      : "No verified provider connection"
                  }
                />
                <StatusCard
                  label="Devices"
                  value={String(data.devices.length)}
                  note="Linked extension installations"
                />
                <StatusCard
                  label="AI usage"
                  value={data.usage.requests.toLocaleString()}
                  note={`of ${data.usage.limits.requests.toLocaleString()} requests this month`}
                />
              </SimpleGrid>
              {data.sessions.enabled && data.sessions.authorized ? (
                <>
                  <Flex mt="8" justify="space-between" align="center">
                    <Box>
                      <Heading size="lg">Recent activity</Heading>
                      <Text color="muted" mt="1">
                        Continue work and review recent runs across your
                        devices.
                      </Text>
                    </Box>
                    <Button asChild variant="outline">
                      <a href="/app/sessions">View all</a>
                    </Button>
                  </Flex>
                  <Box mt="4">
                    <SessionsList sessions={data.sessions.recent.slice(0, 5)} />
                  </Box>
                </>
              ) : null}
            </>
          )}
        </Box>
      </Container>
    </AppShell>
  );
}

function SessionsPage() {
  const [selected, setSelected] = useState<CloudSessionV1 | null>(null);
  const summary = useQuery({
    queryKey: ["cloud-dashboard"],
    queryFn: accountApi.dashboard,
    retry: false,
  });
  const timeline = useQuery({
    queryKey: ["cloud-session-timeline", selected?.sessionId],
    queryFn: () => accountApi.sessionTimeline(selected!.sessionId),
    enabled: Boolean(selected),
    retry: false,
  });
  return (
    <AppShell>
      <Container maxW="6xl" py={{ base: "8", md: "12" }}>
        <Heading size="2xl">Sessions</Heading>
        <Text mt="2" color="muted">
          Cloud metadata and operational events. Page content and detailed
          traces are not loaded.
        </Text>
        <Box mt="8">
          {summary.isPending ? (
            <Loading />
          ) : summary.error || !summary.data ? (
            <Failure error={summary.error} />
          ) : (
            <SimpleGrid columns={{ base: 1, lg: selected ? 2 : 1 }} gap="6">
              <SessionsList
                sessions={summary.data.sessions.recent}
                select={setSelected}
              />
              {selected ? (
                <Box {...card} p="6">
                  <Flex justify="space-between" gap="3">
                    <Box>
                      <Heading size="md">{selected.title}</Heading>
                      <Text color="muted" fontSize="sm" mt="1">
                        Operational timeline
                      </Text>
                    </Box>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelected(null)}
                    >
                      Close
                    </Button>
                  </Flex>
                  {timeline.isPending ? (
                    <Skeleton h="48" mt="5" />
                  ) : timeline.error ? (
                    <Text mt="5" color="danger">
                      {timeline.error instanceof Error
                        ? timeline.error.message
                        : "Timeline unavailable."}
                    </Text>
                  ) : (
                    <Stack
                      mt="6"
                      gap="5"
                      borderLeftWidth="2px"
                      borderColor="line"
                      pl="5"
                    >
                      {timeline.data?.events.map((event) => (
                        <Box key={event.id}>
                          <Text fontWeight="700">{event.label}</Text>
                          <Text color="muted" fontSize="sm">
                            {event.detail}
                          </Text>
                          <Text color="muted" fontSize="xs" mt="1">
                            {new Date(event.occurredAt).toLocaleString()}
                          </Text>
                        </Box>
                      ))}
                    </Stack>
                  )}
                  <Box mt="7" bg="paper" borderRadius="lg" p="4">
                    <Text fontWeight="700">Detailed trace stays local</Text>
                    <Text color="muted" fontSize="sm" mt="1">
                      Open the Trace Viewer from the OpenSidebar extension on
                      the device that ran this session.
                    </Text>
                  </Box>
                </Box>
              ) : null}
            </SimpleGrid>
          )}
        </Box>
      </Container>
    </AppShell>
  );
}

function ActivationPage() {
  const query = useQuery({
    queryKey: ["cloud-activation"],
    queryFn: accountApi.activation,
    retry: false,
  });
  return (
    <AppShell>
      <Container maxW="5xl" py={{ base: "8", md: "12" }}>
        <Flex justify="space-between" align="center" gap="4">
          <Box>
            <Text color="accent" fontWeight="700" fontSize="xs">
              INTERNAL · READ ONLY
            </Text>
            <Heading size="2xl" mt="2">
              Activation
            </Heading>
          </Box>
          <Badge colorPalette="gray">No controls</Badge>
        </Flex>
        <Text mt="3" color="muted">
          This page reports effective server state. It cannot activate, roll
          back, or edit tester access.
        </Text>
        <Box mt="8">
          {query.isPending ? (
            <Loading />
          ) : query.error || !query.data ? (
            <Failure error={query.error} />
          ) : (
            <>
              <Box {...card} p="6">
                <Flex justify="space-between" align="center">
                  <Box>
                    <Text color="muted" fontSize="sm">
                      Current stage
                    </Text>
                    <Heading mt="1">{query.data.stage}</Heading>
                  </Box>
                  <Badge
                    colorPalette={
                      query.data.stage === "disabled" ? "gray" : "orange"
                    }
                  >
                    {query.data.namedTesterCount} named tester(s)
                  </Badge>
                </Flex>
              </Box>
              <SimpleGrid columns={{ base: 1, md: 2 }} gap="3" mt="5">
                {Object.entries(query.data.flags).map(([name, enabled]) => (
                  <Flex key={name} {...card} p="4" justify="space-between">
                    <Text>{name.replace(/([A-Z])/g, " $1")}</Text>
                    <Badge colorPalette={enabled ? "orange" : "gray"}>
                      {enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </Flex>
                ))}
              </SimpleGrid>
              <Box
                mt="5"
                borderWidth="1px"
                borderColor="line"
                borderRadius="card"
                p="5"
              >
                <Text fontWeight="700">Temporal is not part of activation</Text>
                <Text color="muted" fontSize="sm" mt="1">
                  PostgreSQL remains authoritative. Both Temporal capabilities
                  must remain disabled.
                </Text>
              </Box>
            </>
          )}
        </Box>
      </Container>
    </AppShell>
  );
}

export function DashboardPage() {
  if (location.pathname === "/app/sessions") return <SessionsPage />;
  if (location.pathname === "/app/internal/activation")
    return <ActivationPage />;
  return <Overview />;
}
