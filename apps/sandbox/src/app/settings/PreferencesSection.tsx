import { useDraftWarning } from "../draft-warning";
import { useEffect } from "react";
import { Box, Button, Flex, Heading, SimpleGrid, Text } from "@chakra-ui/react";
import { Settings2 } from "lucide-react";
import { useForm } from "react-hook-form";
import type { CloudPreferencesV1 } from "@opensidebar/shared-types";
type PreferenceForm = Pick<
  CloudPreferencesV1,
  "inferenceMode" | "providerMode" | "maxTurns" | "theme" | "showSessionMetrics"
>;

export function PreferencesSection({
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
  const {
    register,
    handleSubmit,
    reset,
    formState: { isDirty },
  } = useForm<PreferenceForm>({
    defaultValues: defaults,
  });
  useDraftWarning(isDirty);
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
      p={{ base: "4", md: "5" }}
    >
      <Heading size="md" className="os-section-title">
        <Settings2 size={18} aria-hidden="true" />
        Synced preferences
      </Heading>
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
            <input type="hidden" {...register("providerMode")} />
            <Text>OpenRouter</Text>
          </label>
          <label>
            <Text fontSize="sm" mb="1">
              Extension theme
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
        <Button
          type="submit"
          mt="5"
          colorPalette="blue"
          loading={busy}
          disabled={!isDirty}
        >
          Save preferences
        </Button>
      </Box>
    </Box>
  );
}
