import {
  Badge,
  Box,
  Container,
  Flex,
  Heading,
  SimpleGrid,
  Text,
} from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { accountApi } from "../account-api";
import { AppShell } from "./AppShell";
import { ErrorState, LoadingState } from "./WorkspaceUi";
const card = {
  bg: "surface",
  borderWidth: "1px",
  borderColor: "line",
  borderRadius: "card",
} as const;
export function ActivationPage() {
  const query = useQuery({
    queryKey: ["cloud-activation"],
    queryFn: accountApi.activation,
    retry: false,
  });
  return (
    <AppShell>
      <Container maxW="5xl" className="os-page-container">
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
            <LoadingState />
          ) : query.error || !query.data ? (
            <ErrorState
              error={query.error}
              retry={() => void query.refetch()}
            />
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
