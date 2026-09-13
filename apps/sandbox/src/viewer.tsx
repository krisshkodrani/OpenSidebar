import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Container,
  Flex,
  Heading,
  Input,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react";
import {
  createRecoveryKey,
  decryptTraceBundle,
  inspectEncryptedTrace,
  summarizeTraceBundle,
  type TraceBundleSummary,
} from "@trace-sync";
import { AppShell } from "./app/AppShell";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountApi } from "./account-api";
import { readTraceRecoveryKey, writeTraceRecoveryKey } from "./trace-key-store";

type LoadedTrace = {
  summary: TraceBundleSummary;
  bundle: Record<string, unknown>;
  source: "local" | "cloud";
};

const readEntries = (bundle: Record<string, unknown>) =>
  Array.isArray(bundle.entries) ? bundle.entries.slice(0, 200) : [];

export function ViewerPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [trace, setTrace] = useState<LoadedTrace | null>(null);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cloudQuery = useQuery({
    queryKey: ["cloud-traces"],
    queryFn: async () => {
      const [traces, usage] = await Promise.all([
        accountApi.traces(),
        accountApi.traceUsage(),
      ]);
      return { traces, usage };
    },
    retry: false,
  });
  const deleteMutation = useMutation({
    mutationFn: accountApi.deleteTrace,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["cloud-traces"] }),
  });
  useEffect(() => {
    void readTraceRecoveryKey()
      .then(setRecoveryKey)
      .catch(() => undefined);
  }, []);

  const importFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const raw = new Uint8Array(await file.arrayBuffer());
      let bundle: Record<string, unknown>;
      try {
        inspectEncryptedTrace(raw);
        if (!recoveryKey.trim())
          throw new Error("Enter the recovery key for this encrypted trace.");
        bundle = (await decryptTraceBundle(raw, recoveryKey.trim())).bundle;
      } catch (cause) {
        if (new TextDecoder().decode(raw.slice(0, 11)) === "OS-TRACE-1\n")
          throw cause;
        const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("The selected JSON file is not a trace bundle.");
        bundle = parsed as Record<string, unknown>;
      }
      setTrace({
        summary: summarizeTraceBundle(bundle),
        bundle,
        source: "local",
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not open this trace.",
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const generateRecoveryKey = async () => {
    const value = await createRecoveryKey();
    await writeTraceRecoveryKey(value);
    setRecoveryKey(value);
  };

  const openCloudTrace = async (traceId: string) => {
    if (!recoveryKey.trim()) {
      setError("Enter the recovery key for this encrypted trace.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await decryptTraceBundle(
        await accountApi.downloadTrace(traceId),
        recoveryKey.trim(),
      );
      setTrace({
        summary: summarizeTraceBundle(result.bundle),
        bundle: result.bundle,
        source: "cloud",
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not open cloud trace.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <Container as="main" maxW="6xl" py={{ base: "8", md: "14" }}>
        <Flex justify="space-between" align="start" gap="5" wrap="wrap">
          <Box>
            <Text
              color="accent"
              fontWeight="700"
              letterSpacing="wide"
              textTransform="uppercase"
              fontSize="xs"
            >
              Run Viewer
            </Text>
            <Heading size="2xl" mt="2">
              Understand every agent run.
            </Heading>
            <Text color="muted" mt="3" maxW="2xl">
              Open an exported run to inspect its steps, screenshots, and
              technical details on this device.
            </Text>
          </Box>
          <Button
            colorPalette="blue"
            loading={busy}
            onClick={() => fileRef.current?.click()}
          >
            Import run
          </Button>
          <input
            ref={fileRef}
            hidden
            type="file"
            accept=".json,.ostrace,application/json,application/octet-stream"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
            }}
          />
        </Flex>

        <SimpleGrid columns={{ base: 1, lg: 3 }} gap="5" mt="8">
          <Box
            bg="surface"
            borderWidth="1px"
            borderColor="line"
            borderRadius="card"
            p="5"
            gridColumn={{ lg: "span 2" }}
          >
            {trace ? (
              <Stack gap="5">
                <Flex justify="space-between" gap="4" wrap="wrap">
                  <Box>
                    <Heading size="lg">{trace.summary.title}</Heading>
                    <Text color="muted" fontSize="sm" mt="1">
                      {trace.summary.traceId}
                    </Text>
                  </Box>
                  <Badge colorPalette="green">
                    {trace.source === "cloud"
                      ? "Cloud · decrypted here"
                      : "Local import"}
                  </Badge>
                </Flex>
                <SimpleGrid columns={{ base: 2, md: 4 }} gap="3">
                  <Metric label="Entries" value={trace.summary.entryCount} />
                  <Metric
                    label="Screenshots"
                    value={trace.summary.screenshotCount}
                  />
                  <Metric
                    label="Schema"
                    value={trace.summary.bundleSchemaVersion}
                  />
                  <Metric
                    label="Started"
                    value={new Date(
                      trace.summary.createdAt,
                    ).toLocaleDateString()}
                  />
                </SimpleGrid>
                <Box>
                  <Heading size="sm" mb="3">
                    Timeline preview
                  </Heading>
                  <Stack gap="2" maxH="420px" overflowY="auto">
                    {readEntries(trace.bundle).map((entry, index) => (
                      <Box key={index} bg="bg" borderRadius="md" px="4" py="3">
                        <Text fontSize="xs" color="muted">
                          Step {index + 1}
                        </Text>
                        <Text fontSize="sm" mt="1" whiteSpace="pre-wrap">
                          {typeof entry === "string"
                            ? entry
                            : JSON.stringify(entry, null, 2)}
                        </Text>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              </Stack>
            ) : (
              <Box py="16" textAlign="center">
                <Heading size="md">No run open</Heading>
                <Text color="muted" mt="2">
                  Import a JSON export or an encrypted .ostrace run bundle.
                </Text>
              </Box>
            )}
          </Box>

          <Stack gap="5">
            <Box
              bg="surface"
              borderWidth="1px"
              borderColor="line"
              borderRadius="card"
              p="5"
            >
              <Heading size="md">Recovery key</Heading>
              <Text color="muted" fontSize="sm" mt="2">
                This key stays in this browser. OpenSidebar cannot recover it or
                decrypt your traces.
              </Text>
              <Input
                mt="4"
                type="password"
                value={recoveryKey}
                placeholder="Paste recovery key"
                onChange={(event) => setRecoveryKey(event.target.value)}
              />
              <Flex mt="3" gap="2" wrap="wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void writeTraceRecoveryKey(recoveryKey.trim());
                    setError(null);
                  }}
                >
                  Save on device
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void generateRecoveryKey()}
                >
                  Generate new
                </Button>
              </Flex>
            </Box>
            {cloudQuery.data ? (
              <Box
                bg="surface"
                borderWidth="1px"
                borderColor="line"
                borderRadius="card"
                p="5"
              >
                <Flex align="center" justify="space-between">
                  <Heading size="md">Synced runs</Heading>
                  <Badge colorPalette="green">Connected</Badge>
                </Flex>
                {
                  <Stack mt="4" gap="3">
                    <Text color="muted" fontSize="xs">
                      {Math.round(
                        cloudQuery.data.usage.usedBytes / 1024 / 1024,
                      )}{" "}
                      MB of 500 MB · {cloudQuery.data.usage.traceCount} traces
                    </Text>
                    {cloudQuery.data.traces.length === 0 ? (
                      <Text color="muted" fontSize="sm">
                        No encrypted traces uploaded yet.
                      </Text>
                    ) : (
                      cloudQuery.data.traces.map((item) => (
                        <Box
                          key={item.traceId}
                          borderTopWidth="1px"
                          borderColor="line"
                          pt="3"
                        >
                          <Text fontWeight="600" fontSize="sm">
                            {item.title}
                          </Text>
                          <Text color="muted" fontSize="xs" mt="1">
                            {new Date(item.createdAt).toLocaleString()}
                          </Text>
                          <Flex gap="2" mt="2">
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={item.state !== "available"}
                              onClick={() => void openCloudTrace(item.traceId)}
                            >
                              Open
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              colorPalette="red"
                              onClick={() =>
                                deleteMutation.mutate(item.traceId)
                              }
                            >
                              Delete
                            </Button>
                          </Flex>
                        </Box>
                      ))
                    )}
                  </Stack>
                }
              </Box>
            ) : null}
          </Stack>
        </SimpleGrid>
        {error ? (
          <Text role="alert" color="danger" mt="5">
            {error}
          </Text>
        ) : null}
      </Container>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Box bg="bg" borderRadius="md" p="3">
      <Text fontSize="xs" color="muted">
        {label}
      </Text>
      <Text fontWeight="700" mt="1">
        {value}
      </Text>
    </Box>
  );
}
