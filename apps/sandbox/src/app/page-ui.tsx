import type { ReactNode } from "react";
import {
  Box,
  Container,
  Flex,
  Heading,
  Text,
  type ContainerProps,
} from "@chakra-ui/react";
export const card = {
  bg: "surface",
  borderWidth: "1px",
  borderColor: "line",
  borderRadius: "card",
  boxShadow: "card",
  p: "5",
} as const;
export function PageLayout(props: ContainerProps) {
  return (
    <Container
      maxW="6xl"
      px={{ base: "5", md: "8", xl: "10" }}
      py={{ base: "7", md: "10" }}
      {...props}
    />
  );
}
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <Flex justify="space-between" align="start" gap="5" wrap="wrap" mb="8">
      <Box maxW="3xl">
        <Heading as="h1" size="2xl">
          {title}
        </Heading>
        <Text mt="2" color="muted" lineHeight="tall">
          {description}
        </Text>
      </Box>
      {actions}
    </Flex>
  );
}
