import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Container,
  Flex,
  Heading,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import type { CloudPreferencesV1 } from "@opensidebar/shared-types";
import { accountApi } from "./account-api";
import { AppShell } from "./app/AppShell";

export function AccountPage() {
  const queryClient = useQueryClient();
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [credentialDrafts, setCredentialDrafts] = useState<
    Record<string, string>
  >({});
  const accountQuery = useQuery({
    queryKey: ["cloud-account"],
    queryFn: async () => {
      const [account, devices, credentials, usage, preferences] =
        await Promise.all([
          accountApi.account(),
          accountApi.devices(),
          accountApi.credentials(),
          accountApi.usage(),
          accountApi.preferences(),
        ]);
      return { account, devices, credentials, usage, preferences };
    },
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (operation: () => Promise<unknown>) => operation(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["cloud-account"] }),
  });
  const {
    account,
    devices = [],
    credentials = [],
    usage,
    preferences,
  } = accountQuery.data ?? {};
  const error = accountQuery.error ?? mutation.error;
  const errorMessage =
    error instanceof Error ? error.message : error ? String(error) : null;
  const act = (operation: () => Promise<unknown>) => mutation.mutate(operation);
  if (errorMessage && !account)
    return (
      <AppShell>
        <Container maxW="3xl" py="20">
          <Heading>OpenSidebar account</Heading>
          <Text mt="4" color="danger">
            {errorMessage}
          </Text>
          <Button
            mt="6"
            colorPalette="blue"
            onClick={() =>
              location.assign("/api/v1/playground/auth/login?return=/account")
            }
          >
            Sign in
          </Button>
        </Container>
      </AppShell>
    );
  return (
    <AppShell>
      <Container maxW="5xl" py={{ base: "8", md: "14" }}>
        <Flex justify="space-between" align="start" gap="4" wrap="wrap">
          <Box>
            <Text
              color="accent"
              fontWeight="700"
              letterSpacing="wide"
              textTransform="uppercase"
              fontSize="xs"
            >
              OpenSidebar account
            </Text>
            <Heading size="2xl" mt="2">
              Settings
            </Heading>
            <Text mt="2" color="muted">
              {account?.email ?? "Loading account…"}
            </Text>
          </Box>
          <Flex gap="3">
            <Button variant="outline" onClick={() => location.assign("/app")}>
              Dashboard
            </Button>
            <Button
              variant="outline"
              onClick={() => location.assign("/app/playground")}
            >
              Open Playground
            </Button>
          </Flex>
        </Flex>
        {errorMessage ? (
          <Box
            mt="6"
            borderWidth="1px"
            borderColor="danger"
            borderRadius="card"
            p="4"
          >
            <Text color="danger">{errorMessage}</Text>
          </Box>
        ) : null}
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="5" mt="8">
          <Box
            bg="surface"
            borderWidth="1px"
            borderColor="line"
            borderRadius="card"
            boxShadow="card"
            p="6"
          >
            <Heading size="md">Link the extension</Heading>
            <Text mt="2" color="muted" fontSize="sm">
              Generate a single-use code, then open Extension Settings → Account
              → Use a link code instead.
            </Text>
            {linkCode ? (
              <Text
                mt="5"
                fontFamily="mono"
                fontSize="3xl"
                letterSpacing="widest"
                fontWeight="700"
              >
                {linkCode}
              </Text>
            ) : (
              <Button
                mt="5"
                colorPalette="blue"
                onClick={() =>
                  void act(async () =>
                    setLinkCode((await accountApi.linkCode()).code),
                  )
                }
              >
                Generate link code
              </Button>
            )}
            <Text mt="3" color="muted" fontSize="xs">
              Codes expire after 10 minutes.
            </Text>
          </Box>
          <Box
            bg="surface"
            borderWidth="1px"
            borderColor="line"
            borderRadius="card"
            boxShadow="card"
            p="6"
          >
            <Heading size="md">Monthly AI usage</Heading>
            <Text mt="5" fontSize="2xl" fontWeight="700">
              {usage?.requests ?? 0} / {usage?.limits.requests ?? 2_000}{" "}
              requests
            </Text>
            <Text color="muted">
              {(
                (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0)
              ).toLocaleString()}{" "}
              / {(usage?.limits.tokens ?? 10_000_000).toLocaleString()} tokens
            </Text>
            <Text mt="3" fontSize="sm" color="muted">
              {usage?.concurrentStreams ?? 0} active stream(s)
            </Text>
          </Box>
        </SimpleGrid>
        <PreferencesCard
          preferences={preferences ?? null}
          busy={mutation.isPending}
          save={(value, expected) =>
            act(() => accountApi.savePreferences(value, expected))
          }
        />
        <Box
          mt="5"
          bg="surface"
          borderWidth="1px"
          borderColor="line"
          borderRadius="card"
          boxShadow="card"
          p="6"
        >
          <Heading size="md">Provider connections</Heading>
          <Stack mt="4" gap="3">
            {credentials.map((credential) => (
              <Flex
                key={credential.provider}
                justify="space-between"
                align="center"
                gap="4"
                direction={{ base: "column", md: "row" }}
              >
                <Box>
                  <Text fontWeight="700" textTransform="capitalize">
                    {credential.provider}
                  </Text>
                  <Text color="muted" fontSize="sm">
                    {credential.configured
                      ? `Encrypted · fingerprint ${credential.fingerprint}`
                      : "Not stored"}
                  </Text>
                </Box>
                <Flex gap="3" align="center">
                  <Badge
                    colorPalette={
                      credential.verification === "valid" ? "green" : "gray"
                    }
                  >
                    {credential.verification}
                  </Badge>
                  {credential.configured ? (
                    <Button
                      size="sm"
                      variant="outline"
                      colorPalette="red"
                      onClick={() =>
                        void act(() =>
                          accountApi.deleteCredential(credential.provider),
                        )
                      }
                    >
                      Delete
                    </Button>
                  ) : null}
                </Flex>
                <Flex gap="2" w={{ base: "full", md: "420px" }}>
                  <input
                    aria-label={`${credential.provider} API key`}
                    type="password"
                    autoComplete="off"
                    value={credentialDrafts[credential.provider] ?? ""}
                    placeholder={
                      credential.configured
                        ? "Enter replacement key"
                        : "Enter API key"
                    }
                    onChange={(event) =>
                      setCredentialDrafts((current) => ({
                        ...current,
                        [credential.provider]: event.target.value,
                      }))
                    }
                    className="account-secret-input"
                  />
                  <Button
                    size="sm"
                    colorPalette="blue"
                    disabled={
                      !credentialDrafts[credential.provider]?.trim() ||
                      mutation.isPending
                    }
                    onClick={() =>
                      void act(async () => {
                        await accountApi.saveCredential(
                          credential.provider,
                          credentialDrafts[credential.provider]!.trim(),
                        );
                        setCredentialDrafts((current) => ({
                          ...current,
                          [credential.provider]: "",
                        }));
                      })
                    }
                  >
                    {credential.configured ? "Replace" : "Verify & store"}
                  </Button>
                </Flex>
              </Flex>
            ))}
          </Stack>
        </Box>
        <Box
          mt="5"
          bg="surface"
          borderWidth="1px"
          borderColor="line"
          borderRadius="card"
          boxShadow="card"
          p="6"
        >
          <Flex justify="space-between" align="center">
            <Box>
              <Heading size="md">Devices</Heading>
              <Text color="muted" fontSize="sm" mt="1">
                Revoke devices you no longer use.
              </Text>
            </Box>
            <Button
              variant="outline"
              colorPalette="red"
              onClick={() => void act(accountApi.logoutAll)}
            >
              Sign out extension devices
            </Button>
          </Flex>
          <Stack mt="5" gap="3">
            {devices.length ? (
              devices.map((device) => (
                <Flex key={device.id} justify="space-between" align="center">
                  <Box>
                    <Text fontWeight="700">{device.displayName}</Text>
                    <Text color="muted" fontSize="sm">
                      Version {device.extensionVersion} · last seen{" "}
                      {new Date(device.lastSeenAt).toLocaleString()}
                    </Text>
                  </Box>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void act(() => accountApi.revokeDevice(device.id))
                    }
                  >
                    Revoke
                  </Button>
                </Flex>
              ))
            ) : (
              <Text color="muted">No linked extension devices.</Text>
            )}
          </Stack>
        </Box>
      </Container>
    </AppShell>
  );
}

type PreferenceForm = Pick<
  CloudPreferencesV1,
  "inferenceMode" | "providerMode" | "maxTurns" | "theme" | "showSessionMetrics"
>;

function PreferencesCard({
  preferences,
  busy,
  save,
}: {
  preferences: CloudPreferencesV1 | null;
  busy: boolean;
  save: (value: CloudPreferencesV1, expectedRevision: number) => void;
}) {
  const defaults: PreferenceForm = {
    inferenceMode: preferences?.inferenceMode ?? "local",
    providerMode: preferences?.providerMode ?? "openrouter",
    maxTurns: preferences?.maxTurns ?? 100,
    theme: preferences?.theme ?? "system",
    showSessionMetrics: preferences?.showSessionMetrics ?? true,
  };
  const { register, handleSubmit, reset } = useForm<PreferenceForm>({
    defaultValues: defaults,
  });
  useEffect(() => {
    reset({
      inferenceMode: preferences?.inferenceMode ?? "local",
      providerMode: preferences?.providerMode ?? "openrouter",
      maxTurns: preferences?.maxTurns ?? 100,
      theme: preferences?.theme ?? "system",
      showSessionMetrics: preferences?.showSessionMetrics ?? true,
    });
  }, [preferences, reset]);
  return (
    <Box
      mt="5"
      bg="surface"
      borderWidth="1px"
      borderColor="line"
      borderRadius="card"
      boxShadow="card"
      p="6"
    >
      <Heading size="md">Synced preferences</Heading>
      <Text mt="1" color="muted" fontSize="sm">
        Only product preferences sync. Approval, navigation, site-access,
        permissions, and telemetry controls always stay on each device.
      </Text>
      <Box
        as="form"
        className="account-preferences"
        mt="4"
        onSubmit={handleSubmit((value) =>
          save(
            {
              ...(preferences ?? {}),
              schemaVersion: 1,
              revision: (preferences?.revision ?? 0) + 1,
              ...value,
            },
            preferences?.revision ?? 0,
          ),
        )}
      >
        <SimpleGrid columns={{ base: 1, md: 2 }} gap="4">
          <label>
            <Text fontSize="sm" mb="1">
              Inference mode
            </Text>
            <select {...register("inferenceMode")}>
              <option value="local">Direct from this browser</option>
              <option value="cloud">Use account connection</option>
            </select>
          </label>
          <label>
            <Text fontSize="sm" mb="1">
              Provider
            </Text>
            <select {...register("providerMode")}>
              <option value="openrouter">OpenRouter</option>
              <option value="fireworks">Fireworks</option>
            </select>
          </label>
          <label>
            <Text fontSize="sm" mb="1">
              Theme
            </Text>
            <select {...register("theme")}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label>
            <Text fontSize="sm" mb="1">
              Maximum turns
            </Text>
            <input
              type="number"
              min="1"
              max="200"
              {...register("maxTurns", { valueAsNumber: true })}
            />
          </label>
        </SimpleGrid>
        <label>
          <Flex mt="4" gap="2" align="center">
            <input type="checkbox" {...register("showSessionMetrics")} />
            <Text fontSize="sm">Show session metrics</Text>
          </Flex>
        </label>
        <Button type="submit" mt="5" colorPalette="blue" loading={busy}>
          Save synced preferences
        </Button>
      </Box>
    </Box>
  );
}
