import type { ReactNode } from "react";
import { Badge, Box, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import type { BoxProps } from "@chakra-ui/react";

export const surfaceCard = {
  bg: "surface",
  borderWidth: "1px",
  borderColor: "line",
  borderRadius: "card",
  boxShadow: "card",
} as const;

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Flex justify="space-between" align="start" gap="5" wrap="wrap">
      <Box minW="0">
        <Text
          color="accent"
          fontWeight="700"
          letterSpacing="wide"
          textTransform="uppercase"
          fontSize="xs"
        >
          {eyebrow}
        </Text>
        <Heading size="2xl" mt="2" overflowWrap="anywhere">
          {title}
        </Heading>
        {description ? (
          <Text mt="2" color="muted" maxW="2xl">
            {description}
          </Text>
        ) : null}
      </Box>
      {action}
    </Flex>
  );
}

export function SurfaceCard({ children, ...props }: BoxProps) {
  return (
    <Box {...surfaceCard} p="6" {...props}>
      {children}
    </Box>
  );
}

export function StatusBadge({
  children,
  tone = "gray",
}: {
  children: ReactNode;
  tone?: "gray" | "green" | "orange" | "red" | "blue";
}) {
  return <Badge colorPalette={tone}>{children}</Badge>;
}

export function Notice({
  children,
  role = "status",
  tone = "info",
}: {
  children: ReactNode;
  role?: "status" | "alert";
  tone?: "info" | "success" | "warning" | "danger";
}) {
  const colors = {
    info: ["accent", "surfaceMuted"],
    success: ["success", "surfaceMuted"],
    warning: ["warning", "surfaceMuted"],
    danger: ["danger", "surfaceMuted"],
  } as const;
  return (
    <Box
      role={role}
      borderWidth="1px"
      borderColor={colors[tone][0]}
      bg={colors[tone][1]}
      borderRadius="lg"
      px="4"
      py="3"
      color={colors[tone][0]}
    >
      {children}
    </Box>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Stack {...surfaceCard} align="start" gap="3" p={{ base: "6", md: "8" }}>
      <Heading size="md">{title}</Heading>
      <Text color="muted">{description}</Text>
      {action}
    </Stack>
  );
}
