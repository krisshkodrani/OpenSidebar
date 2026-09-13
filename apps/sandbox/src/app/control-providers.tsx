import type { PropsWithChildren } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./query-client";
import { openSidebarSystem } from "./theme";
import { AppearanceProvider } from "./appearance";

export function ControlProviders({ children }: PropsWithChildren) {
  return (
    <ChakraProvider value={openSidebarSystem}>
      <QueryClientProvider client={queryClient}>
        <AppearanceProvider>{children}</AppearanceProvider>
      </QueryClientProvider>
    </ChakraProvider>
  );
}
