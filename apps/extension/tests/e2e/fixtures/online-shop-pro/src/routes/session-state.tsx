import { useEffect, useState } from "react";

function readCookie(name: string): string {
  const prefix = `${name}=`;
  return (
    document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix))
      ?.slice(prefix.length) ?? ""
  );
}

export default function SessionStateProbe() {
  const [state, setState] = useState({
    sessionCookie: "",
    workspace: "",
    runId: "",
  });

  useEffect(() => {
    setState({
      sessionCookie: readCookie("workarena_session"),
      workspace: window.localStorage.getItem("workspace") ?? "",
      runId: window.sessionStorage.getItem("run_id") ?? "",
    });
  }, []);

  return (
    <main className="page session-state-page">
      <section className="hero">
        <p className="eyebrow">Session state probe</p>
        <h1>Imported browser state</h1>
      </section>

      <section className="card-grid">
        <article className="card">
          <h2>Cookie</h2>
          <p data-testid="session-cookie">{state.sessionCookie || "missing"}</p>
        </article>
        <article className="card">
          <h2>Local storage</h2>
          <p data-testid="session-local-storage">{state.workspace || "missing"}</p>
        </article>
        <article className="card">
          <h2>Session storage</h2>
          <p data-testid="session-session-storage">{state.runId || "missing"}</p>
        </article>
      </section>
    </main>
  );
}
