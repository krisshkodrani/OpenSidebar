import { Badge, Box, Button, Flex, Heading, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountApi } from "./account-api";
import { AppShell } from "./app/AppShell";
import { PageHeader, PageLayout, card } from "./app/page-ui";

const usd = (value: number) => `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`;

export function AnalyticsPage() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["account-run-analytics"], queryFn: accountApi.runAnalytics, retry: false, refetchInterval: 15_000 });
  const consent = useMutation({
    mutationFn: accountApi.setRunAnalyticsConsent,
    onSuccess: () => client.invalidateQueries({ queryKey: ["account-run-analytics"] }),
  });
  const data = query.data;
  const known = data?.runs.filter((run) => run.spendUsd !== null) ?? [];
  const unknown = (data?.runs.length ?? 0) - known.length;
  const total = known.reduce((sum, run) => sum + (run.spendUsd ?? 0), 0);
  return <AppShell><PageLayout>
    <PageHeader title="Run analytics" description="Account-level activity and model spend for new, consented runs. Your browser content and traces stay out of this view." />
    {query.isPending ? <Text role="status">Loading run analytics…</Text> : null}
    {query.error ? <Box {...card} role="alert"><Heading size="md">Analytics unavailable</Heading><Text mt="2">{query.error instanceof Error ? query.error.message : "Try again later."}</Text></Box> : null}
    {data ? <Stack gap="6">
      <Box {...card} borderLeftWidth="4px" borderLeftColor="highlight">
        <Flex justify="space-between" align="center" gap="4" wrap="wrap">
          <Box><Heading size="md">Account analytics {data.enabled ? "on" : "off"}</Heading>
            <Text mt="2" color="muted">Off by default. Only run IDs, times, state, model, tokens, and spend are synced. New runs only. Retained for 90 days. Turning this off deletes synced analytics.</Text></Box>
          <Button disabled={consent.isPending} variant={data.enabled ? "outline" : "solid"} colorPalette={data.enabled ? "red" : "brand"} onClick={() => consent.mutate(!data.enabled)}>{data.enabled ? "Turn off and delete" : "Enable for new runs"}</Button>
        </Flex>
        {data.enabledAt ? <Text mt="3" fontSize="xs" color="muted">Enabled {new Date(data.enabledAt).toLocaleString()}</Text> : null}
        {consent.error ? <Text mt="3" role="alert" color="danger">Could not change analytics consent. Try again.</Text> : null}
      </Box>
      {data.enabled ? <>
        <SimpleGrid columns={{ base: 1, md: 3 }} gap="4">
          <Box {...card}><Text color="muted">Observed runs</Text><Heading mt="2" size="2xl">{data.runs.length}</Heading><Text color="muted" fontSize="sm">Up to 100 recent runs</Text></Box>
          <Box {...card}><Text color="muted">Recorded model spend</Text><Heading mt="2" size="2xl">{usd(total)}</Heading><Text color="muted" fontSize="sm">From {known.length} runs with known spend</Text></Box>
          <Box {...card}><Text color="muted">Spend unavailable</Text><Heading mt="2" size="2xl">{unknown}</Heading><Text color="muted" fontSize="sm">Excluded from the recorded total</Text></Box>
        </SimpleGrid>
        <Box><Heading size="lg" mb="4">Recent runs</Heading>
          {data.runs.length ? <Stack gap="3">{data.runs.map((run) => <Box {...card} key={run.runId}>
            <Flex justify="space-between" gap="4" wrap="wrap"><Box><Flex gap="2" align="center"><Text fontWeight="700">Run {run.runId.slice(0, 8)}</Text><Badge colorPalette={run.state === "succeeded" ? "green" : run.state === "failed" ? "red" : "gray"}>{run.state === "running" ? "Observed, still running" : run.state}</Badge></Flex>
              <Text color="muted" mt="1" fontSize="sm">{run.source === "remote" ? "Remote" : "Local"}{run.model ? ` · ${run.model}` : ""} · Started {new Date(run.startedAt).toLocaleString()} · Last observed {new Date(run.observedAt).toLocaleString()}</Text></Box>
              <Box textAlign={{ base: "left", md: "right" }}><Text fontWeight="700">{run.spendUsd === null ? "Spend unknown" : usd(run.spendUsd)}</Text><Text color="muted" fontSize="sm">{run.spendProvenance.replaceAll("_", " ")} · {(run.promptTokens + run.completionTokens).toLocaleString()} tokens</Text></Box></Flex>
          </Box>)}</Stack> : <Box {...card}><Text color="muted">No new runs observed since analytics was enabled.</Text></Box>}
        </Box>
      </> : null}
      <Text color="muted" fontSize="sm">Model spend is separate from the cloud relay request quota shown in Settings. Recorded totals are not invoices.</Text>
    </Stack> : null}
  </PageLayout></AppShell>;
}
