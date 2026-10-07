import { LogIn, LogOut, UserRound } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { controlApi } from "../control-api";
import { signInHref } from "./routes";
import { LoadingSpinner, LoadingState } from "./WorkspaceUi";
import { confirmSignOut, retainDraftProtection } from "./draft-warning";

export function AccountMenu() {
  const client = useQueryClient();
  const session = useQuery({
    queryKey: ["browser-session"],
    queryFn: controlApi.session,
    retry: false,
  });
  const logout = useMutation({
    mutationFn: controlApi.logout,
    onError: retainDraftProtection,
    onSuccess: async () => {
      await client.cancelQueries();
      client.clear();
      window.location.replace("/");
    },
  });
  return (
    <div className="os-account-menu">
      {session.data?.authenticated ? (
        <>
          <div className="os-account-identity">
            <UserRound size={17} aria-hidden="true" />
            <div>
              <span>Signed in as</span>
              <strong>{session.data.email ?? "Your account"}</strong>
            </div>
          </div>
          <button
            className="os-button os-logout"
            disabled={logout.isPending}
            aria-busy={logout.isPending}
            onClick={() => {
              if (confirmSignOut()) logout.mutate();
            }}
          >
            {logout.isPending ? <LoadingSpinner /> : <LogOut size={16} aria-hidden="true" />}
            {logout.isPending ? "Signing out…" : "Log out"}
          </button>
          {logout.isError && (
            <p role="alert" className="os-error-text">
              Could not sign out. Please try again.
            </p>
          )}
        </>
      ) : session.isPending ? (
        <LoadingState inline label="Checking your session…" />
      ) : session.isError ? (
        <button className="os-button" onClick={() => void session.refetch()}>
          Retry session check
        </button>
      ) : (
        <a className="os-button" href={signInHref()}>
          <LogIn size={16} aria-hidden="true" />
          Sign in
        </a>
      )}
    </div>
  );
}
