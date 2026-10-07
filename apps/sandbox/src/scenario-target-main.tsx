import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import type { JsonObject, JsonValue, ScenarioTargetViewV2 } from "@opensidebar/scenario-contracts";
import { loadScenarioTarget, sendScenarioAction } from "./scenario-target-api";
import { isScenarioFamily, TARGET_FAMILIES } from "./scenario-target-config";
import { ScenarioEmbeddedContent, ScenarioVisualPresentation } from "./scenario-visual-presentation";
import { ScenarioWorkflow } from "./scenario-workflow";
import { ScenarioLinkedResourceLink, ScenarioLinkedResourcePage } from "./scenario-linked-resource";
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
  if (new URLSearchParams(window.location.search).get("view") === "linked-resource") {
    return <ScenarioLinkedResourcePage value={run.data.linkedResource} />;
  }
  const familyValue = run.data.applicationFamily;
  if (!isScenarioFamily(familyValue)) return <TargetMessage title="Scenario unavailable" body="This scenario does not have a target application yet." />;
  return <ConfiguredTargetApplication run={run} familyValue={familyValue} />;
}
function ConfiguredTargetApplication({ run, familyValue }: { run: ScenarioTargetViewV2; familyValue: keyof typeof TARGET_FAMILIES }) {
  const family = TARGET_FAMILIES[familyValue];
  const [draft, setDraft] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [visibility, setVisibility] = useState("");
  const [current, setCurrent] = useState(run);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const caseState = objectValue(current.data.case);
  const interaction = objectValue(current.data.interaction);
  const note = objectValue(caseState.note);
  const mutable = interaction.mutable === true;
  const requiresValue = interaction.requiresValue === true;
  const terminalDecision = typeof interaction.terminalDecision === "string"
    ? interaction.terminalDecision
    : null;
  const evidence = Array.isArray(current.data.evidence) ? current.data.evidence : [];
  const workflow = Array.isArray(current.data.workflow) ? current.data.workflow : [];
  const workflowState = objectValue(current.data.workflowState);
  const workflowComplete = workflow.length === 0 || workflowState.status === "complete";
  const activeSection = typeof interaction.activeSection === "string" ? interaction.activeSection : family.navigation[0];
  const control = typeof interaction.control === "string" ? interaction.control : "text";
  const fieldDefinitions = Array.isArray(interaction.fields) ? interaction.fields.map(objectValue) : [];
  const missingFields = control === "fields" && fieldDefinitions.some(field => !fields[String(field.key)]);
  const options = Array.isArray(interaction.options) ? interaction.options.filter((value): value is string => typeof value === "string") : [];
  const rows = useMemo(() => [
    ["Status", display(caseState.status)],
    [typeof interaction.valueLabel === "string" ? interaction.valueLabel : family.valueLabel, display(caseState.value)],
    ["Last revision", String(current.revision)],
  ], [caseState.status, caseState.value, current.revision, family.valueLabel, interaction.valueLabel]);
  const save = async () => {
    if (missingFields || (requiresValue && !draft.trim()) || (control === "note" && !visibility)) return;
    setBusy(true);
    setFeedback(null);
    try {
      setCurrent(await sendScenarioAction(
        "case.submit",
        control === "fields" ? { fields } : requiresValue ? { value: draft.trim(), ...(control === "note" ? { visibility } : {}) } : { decision: "apply" },
      ));
      setDraft("");
      setFeedback("Changes saved.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Changes could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const recordTerminalDecision = async () => {
    if (!terminalDecision) return;
    setBusy(true);
    setFeedback(null);
    try {
      setCurrent(await sendScenarioAction("case.terminal", { decision: terminalDecision }));
      setFeedback("Decision recorded.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Decision could not be recorded.");
    } finally {
      setBusy(false);
    }
  };
  const workflowAction = async (type: "workflow.advance" | "workflow.recover", payload: JsonObject = {}) => {
    setBusy(true);
    setFeedback(null);
    try {
      setCurrent(await sendScenarioAction(type, payload));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The workflow could not be updated.");
    } finally {
      setBusy(false);
    }
  };
  return <div className="scenario-app" style={{ "--accent": family.accent } as CSSProperties}>
    <header className="scenario-topbar"><div><strong>{family.brand}</strong><span>{family.section}</span></div><small>OpenSidebar Playground · simulated application</small></header>
    <div className="scenario-layout">
      <nav aria-label="Application navigation">{family.navigation.map((item) => <span aria-current={item === activeSection ? "page" : undefined} className={item === activeSection ? "active" : ""} key={item}>{item}</span>)}</nav>
      <main>
        <div className="scenario-heading"><div><p>Workspace</p><h1>{display(caseState.title)}</h1></div><span className="scenario-pill">{display(caseState.status)}</span></div>
        <section className="scenario-panel"><h2>Details</h2><table><tbody>{rows.map(([label, value]) => <tr key={label}><th>{label}</th><td>{value}</td></tr>)}</tbody></table></section>
        {caseState.fields && <section className="scenario-panel"><h2>Saved record</h2><dl>{fieldDefinitions.map(field => <div key={String(field.key)}><dt>{display(field.label)}</dt><dd>{display(objectValue(caseState.fields)[String(field.key)])}</dd></div>)}</dl></section>}
        {typeof note.text === "string" && <section className="scenario-panel"><h2>Saved note</h2><p>Visibility: {display(note.visibility)}</p><p>{note.text}</p></section>}
        {current.lifecycle === "finished" && <section className="scenario-panel scenario-success" role="status"><h2>Saved successfully</h2><p>The requested change is complete. The details above show the current record state.</p></section>}
        <ScenarioVisualPresentation value={current.data.presentation} />
        <ScenarioEmbeddedContent value={current.data.safety} />
        <ScenarioLinkedResourceLink value={current.data.linkedResource} />
        <ScenarioWorkflow workflow={current.data.workflow} workflowState={current.data.workflowState} dynamics={current.data.dynamics} busy={busy} finalActionComplete={current.lifecycle === "finished"} onAdvance={(stageId) => void workflowAction("workflow.advance", { stageId })} onRecover={() => void workflowAction("workflow.recover")} />
        {(workflow.length === 0 || current.lifecycle === "finished") && evidence.length > 0 && <section className="scenario-panel"><h2>Initial reference information</h2><dl className="scenario-evidence">{evidence.map((entry, index) => { const item = objectValue(entry); return <div key={index}><dt>{display(item.label)}</dt><dd>{display(item.value)}</dd></div>; })}</dl></section>}
        {typeof current.data.notice === "string" && <section className="scenario-panel scenario-notice"><h2>Action unavailable</h2><p>{current.data.notice}</p></section>}
        {terminalDecision && workflowComplete && current.lifecycle !== "finished" && <section className="scenario-panel scenario-form"><h2>Decision</h2><button className="scenario-primary" disabled={busy} onClick={() => void recordTerminalDecision()}>{busy ? "Saving…" : display(interaction.terminalLabel)}</button>{feedback && <p role="status" className="scenario-feedback">{feedback}</p>}</section>}
        {mutable && workflowComplete && current.lifecycle !== "finished" && <section className="scenario-panel scenario-form"><h2>Update</h2>{control === "fields" && fieldDefinitions.map(field => <label key={String(field.key)}>{display(field.label)}<select value={fields[String(field.key)] ?? ""} onChange={event => setFields({ ...fields, [String(field.key)]: event.target.value })}><option value="">Choose an option</option>{(Array.isArray(field.options) ? field.options : []).map(option => <option key={String(option)} value={String(option)}>{display(option)}</option>)}</select></label>)}{requiresValue && <label>{display(interaction.valueLabel) || family.valueLabel}{control === "note" ? <textarea value={draft} onChange={(event) => setDraft(event.target.value)} /> : control === "select" ? <select value={draft} onChange={(event) => setDraft(event.target.value)}><option value="">Choose an option</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input type={control === "number" || control === "tel" ? control : "text"} value={draft} onChange={(event) => setDraft(event.target.value)} />}</label>}{control === "note" && <label>Visibility<select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="">Choose visibility</option><option value="internal">Internal</option><option value="public">Public</option></select></label>}<button className="scenario-primary" disabled={busy || missingFields || (requiresValue && !draft.trim()) || (control === "note" && !visibility)} onClick={() => void save()}>{busy ? "Saving…" : display(interaction.submitLabel) || family.saveLabel}</button>{feedback && <p role="status" className="scenario-feedback">{feedback}</p>}</section>}
        {feedback && workflow.length > 0 && !workflowComplete && <p role="status" className="scenario-feedback">{feedback}</p>}
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
