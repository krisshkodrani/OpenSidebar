import type { PropsWithChildren } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./query-client";
import { openSidebarSystem } from "./theme";

export function ControlProviders({ children }: PropsWithChildren) {
  return (
    <ChakraProvider value={openSidebarSystem}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ChakraProvider>
  );
}
