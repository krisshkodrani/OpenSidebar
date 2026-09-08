import { useEffect, useRef, useState, type ReactNode } from "react";
import { Box, Button, Flex, Heading, Stack, Text } from "@chakra-ui/react";

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
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const mobilePanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          mobilePanel.current?.querySelectorAll<HTMLElement>(
            'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])',
          ) ?? [],
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    requestAnimationFrame(() =>
      mobilePanel.current?.querySelector<HTMLElement>("button")?.focus(),
    );
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const links = (
    <Stack as="nav" aria-label="OpenSidebar application" mt="7" gap="1">
      {navigation.map(([label, href]) => (
        <Button
          key={href}
          asChild
          variant={activeRoute(href) ? "subtle" : "ghost"}
          justifyContent="start"
          size="sm"
        >
          <a href={href} aria-current={activeRoute(href) ? "page" : undefined}>
            {label}
          </a>
        </Button>
      ))}
    </Stack>
  );
  return (
    <Flex
      minH="100vh"
      direction={{ base: "column", lg: "row" }}
      bg="bg"
      maxW="100vw"
      overflowX="clip"
    >
      <Box
        asChild
        position="fixed"
        top="2"
        left="2"
        zIndex="skipLink"
        transform="translateY(-160%)"
        _focusVisible={{ transform: "translateY(0)" }}
        bg="surface"
        borderRadius="md"
        px="3"
        py="2"
      >
        <a href="#main-content">Skip to main content</a>
      </Box>
      <Box
        as="aside"
        display={{ base: "none", lg: "block" }}
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
        {links}
      </Box>
      <Flex
        display={{ base: "flex", lg: "none" }}
        as="header"
        align="center"
        justify="space-between"
        borderBottomWidth="1px"
        borderColor="line"
        bg="surface"
        px="4"
        py="3"
      >
        <a href="/" aria-label="OpenSidebar home">
          <Heading size="md">OpenSidebar</Heading>
        </a>
        <Button
          ref={menuButton}
          size="sm"
          variant="outline"
          color="fg"
          borderColor="line"
          aria-expanded={open}
          aria-controls="mobile-navigation"
          onClick={() => setOpen(true)}
        >
          Menu
        </Button>
      </Flex>
      {open ? (
        <Box
          display={{ lg: "none" }}
          position="fixed"
          inset="0"
          zIndex="modal"
          bg="blackAlpha.500"
          onClick={() => setOpen(false)}
        >
          <Box
            ref={mobilePanel}
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Application navigation"
            bg="surface"
            color="fg"
            w="min(320px, 86vw)"
            minH="100%"
            p="5"
            onClick={(event) => event.stopPropagation()}
          >
            <Flex justify="space-between" align="center">
              <Heading size="md">OpenSidebar</Heading>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  menuButton.current?.focus();
                }}
              >
                Close
              </Button>
            </Flex>
            {links}
          </Box>
        </Box>
      ) : null}
      <Box id="main-content" flex="1" minW="0">
        {children}
      </Box>
    </Flex>
  );
}
