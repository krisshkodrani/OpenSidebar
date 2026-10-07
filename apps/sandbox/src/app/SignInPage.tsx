import { useEffect, useState } from "react";
import { ArrowRight, Mail } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AuthFrame } from "./AuthFrame";
import { SessionFrame } from "./SessionFrame";
import { ErrorState, LoadingState, LoadingSpinner } from "./WorkspaceUi";
import { controlApi } from "../control-api";
import { safeReturnPath } from "./routes";

export function SignInPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await controlApi.requestCode(email.trim());
      setChallengeId(result.challengeId);
      setCode("");
      setMessage(
        "A new code is on its way. Check your inbox or spam folder. Use the latest email; the code expires in 10 minutes.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not send a code. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    if (!challengeId) return;
    if (!/^\d{6,8}$/.test(code)) {
      setError("Enter the complete 6 to 8 digit code from your email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await controlApi.verifyCode(challengeId, email.trim(), code);
      location.replace(
        safeReturnPath(new URLSearchParams(location.search).get("return")),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "That code did not work. Request a new code and try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const session = useQuery({
    queryKey: ["browser-session"],
    queryFn: controlApi.session,
    retry: false,
  });
  useEffect(() => {
    if (session.data?.authenticated)
      location.replace(
        safeReturnPath(new URLSearchParams(location.search).get("return")),
      );
  }, [session.data]);
  if (session.isError)
    return (
      <SessionFrame>
        <ErrorState
          error={session.error}
          retry={() => void session.refetch()}
        />
      </SessionFrame>
    );
  if (!session.data || session.data.authenticated)
    return (
      <SessionFrame>
        <LoadingState label="Checking your session…" />
      </SessionFrame>
    );
  return (
    <AuthFrame>
      <form
        className="os-signin-form"
        onSubmit={(event) => {
          event.preventDefault();
          void (challengeId ? verify() : send());
        }}
      >
        <Mail size={23} aria-hidden="true" />
        <h1>{challengeId ? "Check your inbox" : "Sign in to OpenSidebar"}</h1>
        <p>
          {challengeId
            ? `Enter the latest code sent to ${email.trim()}.`
            : "Enter your email to continue to your workspace. No password needed."}
        </p>
        <label>
          Email address
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            disabled={Boolean(challengeId) || busy}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
        </label>
        {challengeId && (
          <label>
            Sign-in code
            <input
              autoFocus
              className="os-code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6,8}"
              minLength={6}
              maxLength={8}
              required
              value={code}
              disabled={busy}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, ""))
              }
              placeholder="Enter your code"
              aria-describedby={error ? "signin-error" : "signin-message"}
            />
          </label>
        )}
        {message && (
          <div id="signin-message" className="os-signin-message" role="status">
            {message}
          </div>
        )}
        {error && (
          <div
            id="signin-error"
            className="os-signin-message os-error-text"
            role="alert"
          >
            {error}
          </div>
        )}
        <button className="os-button os-primary" type="submit" disabled={busy} aria-busy={busy}>
          {busy
            ? challengeId ? "Signing in…" : "Sending code…"
            : challengeId
              ? "Continue to workspace"
              : "Email me a code"}
          {busy ? <LoadingSpinner /> : <ArrowRight size={16} aria-hidden="true" />}
        </button>
        {challengeId && (
          <>
            <button
              className="os-secondary-action"
              type="button"
              disabled={busy}
              onClick={() => void send()}
            >
              Send a new code
            </button>
            <button
              className="os-secondary-action"
              type="button"
              disabled={busy}
              onClick={() => {
                setChallengeId(null);
                setCode("");
                setError(null);
                setMessage(null);
              }}
            >
              Use another email
            </button>
          </>
        )}
        <p style={{ marginTop: 24, fontSize: 12 }}>
          Need a hand?{" "}
          <a className="os-text-link" href="mailto:support@playscenario.ai">
            Contact support
          </a>
        </p>
      </form>
    </AuthFrame>
  );
}
