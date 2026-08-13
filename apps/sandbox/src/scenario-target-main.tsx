import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import type { JsonObject, JsonValue, ScenarioTargetViewV2 } from "@opensidebar/scenario-contracts";
import { loadScenarioTarget, sendScenarioAction } from "./scenario-target-api";
import { isScenarioFamily, TARGET_FAMILIES } from "./scenario-target-config";
import "./scenario-target.css";

function objectValue(value: JsonValue | undefined): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
function display(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
function TargetMessage({ title, body }: { title: string; body: string }) {
  return <main className="scenario-message"><p>OpenSidebar Playground · simulated application</p><h1>{title}</h1><p>{body}</p></main>;
}
function TargetApplication({ run }: { run: ScenarioTargetViewV2 }) {
  const familyValue = run.data.applicationFamily;
  if (!isScenarioFamily(familyValue)) return <TargetMessage title="Scenario unavailable" body="This scenario does not have a target application yet." />;
  const family = TARGET_FAMILIES[familyValue];
  const [draft, setDraft] = useState("");
  const [current, setCurrent] = useState(run);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const caseState = objectValue(current.data.case);
  const rows = useMemo(() => [
    ["Status", display(caseState.status)],
    [family.valueLabel, display(caseState.value)],
    ["Last revision", String(current.revision)],
  ], [caseState.status, caseState.value, current.revision, family.valueLabel]);
  const save = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      setCurrent(await sendScenarioAction("case.submit", { value: draft.trim() }));
      setDraft("");
      setFeedback("Changes saved.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Changes could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  return <div className="scenario-app" style={{ "--accent": family.accent } as CSSProperties}>
    <header className="scenario-topbar"><div><strong>{family.brand}</strong><span>{family.section}</span></div><small>OpenSidebar Playground · simulated application</small></header>
    <div className="scenario-layout">
      <nav aria-label="Application navigation">{family.navigation.map((item, index) => <button className={index === 0 ? "active" : ""} key={item}>{item}</button>)}</nav>
      <main>
        <div className="scenario-heading"><div><p>Workspace</p><h1>{display(caseState.title)}</h1></div><span className="scenario-pill">{display(caseState.status)}</span></div>
        <section className="scenario-panel"><h2>Details</h2><table><tbody>{rows.map(([label, value]) => <tr key={label}><th>{label}</th><td>{value}</td></tr>)}</tbody></table></section>
        <section className="scenario-panel scenario-form"><h2>Update</h2><label>{family.valueLabel}<input value={draft} onChange={(event) => setDraft(event.target.value)} /></label><button className="scenario-primary" disabled={busy || !draft.trim()} onClick={() => void save()}>{busy ? "Saving…" : family.saveLabel}</button>{feedback && <p role="status" className="scenario-feedback">{feedback}</p>}</section>
        {objectValue(current.data.unrelated).changed === true && <p role="alert" className="scenario-warning">An unrelated record was changed.</p>}
      </main>
    </div>
  </div>;
}
function App() {
  const [run, setRun] = useState<ScenarioTargetViewV2 | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void loadScenarioTarget().then((value) => active && setRun(value)).catch((cause) => active && setError(cause instanceof Error ? cause.message : "Session unavailable."));
    return () => { active = false; };
  }, []);
  if (error) return <TargetMessage title="That session has ended" body={error} />;
  if (!run) return <TargetMessage title="Loading application" body="Preparing deterministic scenario state…" />;
  return <TargetApplication run={run} />;
}
createRoot(document.getElementById("root")!).render(<App />);
