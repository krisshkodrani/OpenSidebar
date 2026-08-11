import type { ReactNode } from "react";
import { Box, Button, Flex, Heading, Text } from "@chakra-ui/react";

const navigation = [
  ["Overview", "/app"],
  ["Playground", "/app/playground"],
  ["Run Viewer", "/app/viewer"],
  ["Settings", "/app/settings"],
] as const;

function activeRoute(href: string) {
  if (href === "/app") return location.pathname === href;
  return location.pathname === href || location.pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Flex minH="100vh" direction={{ base: "column", lg: "row" }} bg="bg">
      <Box
        as="aside"
        w={{ lg: "248px" }}
        flexShrink="0"
        borderRightWidth={{ lg: "1px" }}
        borderBottomWidth={{ base: "1px", lg: "0" }}
        borderColor="line"
        bg="surface"
        px="5"
        py="5"
      >
        <a href="/" aria-label="OpenSidebar home">
          <Heading size="md">OpenSidebar</Heading>
        </a>
        <Text color="muted" fontSize="xs" mt="1">
          Your browser agent workspace
        </Text>
        <Flex
          as="nav"
          aria-label="OpenSidebar application"
          mt={{ base: "4", lg: "7" }}
          gap="1"
          direction={{ base: "row", lg: "column" }}
          overflowX="auto"
        >
          {navigation.map(([label, href]) => (
            <Button
              key={href}
              asChild
              variant={activeRoute(href) ? "subtle" : "ghost"}
              justifyContent="start"
              size="sm"
              flexShrink="0"
            >
              <a
                href={href}
                aria-current={activeRoute(href) ? "page" : undefined}
              >
                {label}
              </a>
            </Button>
          ))}
        </Flex>
      </Box>
      <Box flex="1" minW="0">
        {children}
      </Box>
    </Flex>
  );
}
