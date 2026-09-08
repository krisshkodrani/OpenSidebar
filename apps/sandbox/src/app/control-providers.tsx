import { useEffect, type PropsWithChildren } from "react";
import { ChakraProvider } from "@chakra-ui/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./query-client";
import { openSidebarSystem } from "./theme";
import { applyColorMode, watchColorMode } from "./color-mode";
import { controlApi } from "../control-api";
import { accountApi } from "../account-api";

export function ControlProviders({ children }: PropsWithChildren) {
  useEffect(() => {
    const unwatch = watchColorMode();
    void controlApi
      .session()
      .then((session) => {
        if (!session.authenticated) return;
        void accountApi
          .preferences()
          .then((preferences) => {
            if (preferences?.theme) applyColorMode(preferences.theme);
          })
          .catch(() => undefined);
      })
      .catch(() => undefined);
    return unwatch;
  }, []);
  return (
    <ChakraProvider value={openSidebarSystem}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ChakraProvider>
  );
}
