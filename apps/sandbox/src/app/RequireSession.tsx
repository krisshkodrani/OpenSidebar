import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { controlApi } from "../control-api";
import { SessionFrame } from "./SessionFrame";
import { ErrorState, LoadingState } from "./WorkspaceUi";
import { signInHref } from "./routes";
export function RequireSession({ children }: { children: ReactNode }) {
  const [expired, setExpired] = useState(false);
  const client = useQueryClient();
  useEffect(() => {
    const expire = () => {
      setExpired(true);
      void client.cancelQueries();
      client.clear();
      location.replace(signInHref());
    };
    window.addEventListener("os:session-expired", expire);
    return () => window.removeEventListener("os:session-expired", expire);
  }, [client]);
  const query = useQuery({
    queryKey: ["browser-session"],
    queryFn: controlApi.session,
    retry: false,
  });
  useEffect(() => {
    if (query.data && !query.data.authenticated) location.replace(signInHref());
  }, [query.data]);
  // Revalidate a restored browser page rather than showing private cached content after logout.
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) location.reload();
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);
  if (expired) return <SessionFrame><LoadingState label="Opening sign-in…" /></SessionFrame>;
  if (query.isError)
    return (
      <SessionFrame>
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      </SessionFrame>
    );
  if (!query.data?.authenticated)
    return (
      <SessionFrame>
        <LoadingState label="Checking your session…" />
      </SessionFrame>
    );
  return children;
}
