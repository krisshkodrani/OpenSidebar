import { useState, type ReactNode } from "react";
import {
  Box,
  Button,
  Flex,
  Heading,
  NativeSelect,
  Text,
} from "@chakra-ui/react";
import { useAppearance } from "./appearance";
const navigation = [
  ["Overview", "/app"],
  ["Playground", "/app/playground"],
  ["Sessions", "/app/sessions"],
  ["Run viewer", "/app/viewer"],
  ["Settings", "/app/settings"],
] as const;
function activeRoute(href: string) {
  if (href === "/app/settings" && location.pathname === "/app/account")
    return true;
  return (
    location.pathname === href ||
    (href !== "/app" && location.pathname.startsWith(`${href}/`))
  );
}
export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { appearance, setAppearance } = useAppearance();
  return (
    <Flex minH="100vh" direction={{ base: "column", lg: "row" }} bg="bg">
      <Box
        asChild
        position="fixed"
        top="-20"
        left="4"
        zIndex="100"
        bg="surface"
        p="3"
        borderRadius="control"
        _focus={{ top: "4" }}
      >
        <a href="#main-content">Skip to content</a>
      </Box>
      <Box
        as="aside"
        w={{ lg: "232px" }}
        flexShrink="0"
        borderRightWidth={{ lg: "1px" }}
        borderBottomWidth={{ base: "1px", lg: "0" }}
        borderColor="line"
        bg="surface"
        px="5"
        py="5"
        position={{ lg: "sticky" }}
        top="0"
        h={{ lg: "100vh" }}
      >
        <Flex justify="space-between" align="center">
          <Box asChild>
            <a href="/" aria-label="OpenSidebar home">
              <Heading size="md" letterSpacing="tight">
                OpenSidebar
                <Text as="span" color="accent">
                  .
                </Text>
              </Heading>
              <Text color="muted" fontSize="xs" mt="1">
                Your browser workspace
              </Text>
            </a>
          </Box>
          <Button
            display={{ lg: "none" }}
            variant="outline"
            aria-expanded={open}
            aria-controls="app-navigation"
            onClick={() => setOpen(!open)}
          >
            {open ? "Close menu" : "Menu"}
          </Button>
        </Flex>
        <Flex
          id="app-navigation"
          as="nav"
          aria-label="Main navigation"
          mt="8"
          gap="1"
          direction="column"
          display={{ base: open ? "flex" : "none", lg: "flex" }}
        >
          {navigation.map(([label, href]) => (
            <Button
              key={href}
              asChild
              variant={activeRoute(href) ? "subtle" : "ghost"}
              colorPalette={activeRoute(href) ? "blue" : "gray"}
              justifyContent="start"
              h="11"
            >
              <a
                href={href}
                aria-current={activeRoute(href) ? "page" : undefined}
              >
                {label}
              </a>
            </Button>
          ))}
          <Box mt="8" pt="5" borderTopWidth="1px" borderColor="line">
            <Text asChild color="muted" fontSize="xs" fontWeight="600">
              <label htmlFor="web-appearance">Website appearance</label>
            </Text>
            <NativeSelect.Root mt="2" size="sm">
              <NativeSelect.Field
                id="web-appearance"
                value={appearance}
                onChange={(e) =>
                  setAppearance(e.target.value as "system" | "light" | "dark")
                }
                bg="surface"
                borderColor="line"
                borderRadius="control"
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Box>
        </Flex>
      </Box>
      <Box as="main" id="main-content" tabIndex={-1} flex="1" minW="0">
        {children}
      </Box>
    </Flex>
  );
}
