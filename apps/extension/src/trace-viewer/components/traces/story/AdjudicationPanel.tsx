import React, { useMemo, useState } from "react";
import type { TraceSession } from "../../../../types/traces";
import type { RunStory } from "../../../analysis/spine";
import type { AnnotationVerdict, RunAnnotation } from "../../../store/types";
import { annotationKeyFor } from "../../../store/types";
import { useStore } from "../../../store";
import {
  buildTrajectoryScorecard,
  buildEvalCase,
  goldenFileName,
} from "../../../analysis";
import * as api from "../../../api";
import Badge from "../../Badge";

// The human adjudication surface at the top of the Story. Puts the CLAIM (what
// the run says it did) next to the EVIDENCE (judge ruling, trajectory verdict)
// and lets a human record agree / disagree / unsure — the verdict that feeds
// regression fixtures. Export is explicit (a button), never automatic.

const OUTCOMES = ["completed", "failure", "partial"];

const VERDICT_BADGE: Record<AnnotationVerdict, "success" | "failure" | "max_turns"> = {
  agree: "success",
  disagree: "failure",
  unsure: "max_turns",
};

export default function AdjudicationPanel({
  session,
  story,
}: {
  session: TraceSession;
  story: RunStory;
}) {
  const entries = useStore((s) => s.currentEntries);
  const annotations = useStore((s) => s.annotations);
  const submitAnnotation = useStore((s) => s.submitAnnotation);
  const markAnnotationExported = useStore((s) => s.markAnnotationExported);

  const key = annotationKeyFor({ runId: session.runId, sessionId: session.sessionId });
  const existing = annotations[key];

  const scorecard = useMemo(
    () => buildTrajectoryScorecard({ session, entries }),
    [session, entries],
  );
  const lastJudge = useMemo(() => {
    const calls = story.segments.flatMap((s) => s.judgeCalls);
    return calls.length ? calls[calls.length - 1] : undefined;
  }, [story]);

  const [verdict, setVerdict] = useState<AnnotationVerdict | null>(
    existing?.verdict ?? null,
  );
  const [correctedOutcome, setCorrectedOutcome] = useState(
    existing?.correctedOutcome ?? "failure",
  );
  const [note, setNote] = useState(existing?.note ?? "");
  const [annotator, setAnnotator] = useState(existing?.annotator ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const submit = async () => {
    if (!verdict) return;
    setBusy(true);
    setStatus(null);
    const saved = await submitAnnotation({
      sessionId: session.sessionId,
      runId: session.runId,
      annotator: annotator.trim() || undefined,
      verdict,
      correctedOutcome: verdict === "disagree" ? correctedOutcome : undefined,
      note: note.trim() || undefined,
      computed: {
        outcome: session.outcome,
        trajectoryVerdict: scorecard.verdict,
        judgeDecision: lastJudge?.decision,
        judgeConfidence: lastJudge?.confidence,
      },
    });
    setBusy(false);
    setStatus(saved ? "Saved." : "Save failed — is the log server running?");
  };

  const exportGolden = async (annotation: RunAnnotation) => {
    setBusy(true);
    setStatus(null);
    try {
      const evalCase = buildEvalCase(annotation, session);
      const name = goldenFileName(annotation.annotatedAt);
      const res = await api.postGolden(name, [evalCase]);
      markAnnotationExported(key, { goldenFile: res.filename });
      setStatus(`Exported to evals/golden/${res.filename}.`);
    } catch (err) {
      setStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setBusy(false);
  };

  return (
    <div className="rounded-lg border border-trace-accent/30 bg-trace-panel p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-trace-muted">
          Adjudicate
        </span>
        {existing && (
          <Badge variant={VERDICT_BADGE[existing.verdict]}>
            {existing.verdict}
          </Badge>
        )}
        {existing?.exported?.goldenFile && (
          <span className="text-[10px] text-state-success">
            exported → {existing.exported.goldenFile}
          </span>
        )}
      </div>

      {/* Claim vs evidence */}
      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded border border-trace-border bg-trace-bg/50 p-2">
          <div className="text-[10px] uppercase tracking-[0.14em] text-trace-muted">
            Claim
          </div>
          {/* The query can be an entire composed node prompt — cap it so the
              verdict controls stay in view; the full text scrolls in place. */}
          <div className="mt-1 max-h-24 overflow-y-auto text-[12px] text-trace-text">
            {session.query}
          </div>
          {session.summary && (
            <div className="mt-1 max-h-16 overflow-y-auto text-[11px] text-trace-subtle">
              {session.summary}
            </div>
          )}
          <div className="mt-1 text-[10px] text-trace-dim">
            outcome: {session.outcome}
          </div>
        </div>
        <div className="rounded border border-trace-border bg-trace-bg/50 p-2">
          <div className="text-[10px] uppercase tracking-[0.14em] text-trace-muted">
            Evidence
          </div>
          <div className="mt-1 text-[11px] text-trace-subtle">
            trajectory verdict:{" "}
            <span className="font-semibold text-trace-text">{scorecard.verdict}</span>{" "}
            (score {scorecard.overallScore}/5)
          </div>
          {lastJudge ? (
            <div className="mt-1 text-[11px] text-trace-subtle">
              judge: {lastJudge.decision ?? "—"}
              {typeof lastJudge.confidence === "number"
                ? ` (conf ${lastJudge.confidence.toFixed(2)})`
                : ""}
              {lastJudge.model ? ` · ${lastJudge.model}` : ""}
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-trace-dim">no judge ruling</div>
          )}
        </div>
      </div>

      {/* Verdict controls */}
      <div className="flex flex-wrap items-center gap-2">
        {(["agree", "disagree", "unsure"] as AnnotationVerdict[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVerdict(v)}
            className={`rounded border px-3 py-1 text-[11px] font-semibold capitalize transition-colors ${
              verdict === v
                ? "border-trace-accent bg-trace-accent/15 text-trace-accent-light"
                : "border-trace-border text-trace-muted hover:text-trace-text"
            }`}
          >
            {v}
          </button>
        ))}
        {verdict === "disagree" && (
          <select
            value={correctedOutcome}
            onChange={(e) => setCorrectedOutcome(e.target.value)}
            className="rounded border border-trace-border bg-trace-bg px-2 py-1 text-[11px] text-trace-text"
          >
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                actually: {o}
              </option>
            ))}
          </select>
        )}
        <input
          value={annotator}
          onChange={(e) => setAnnotator(e.target.value)}
          placeholder="you (optional)"
          className="w-28 rounded border border-trace-border bg-trace-bg px-2 py-1 text-[11px] text-trace-text placeholder:text-trace-dim"
        />
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Why? (optional note — carried into the exported fixture)"
        rows={2}
        className="mt-2 w-full rounded border border-trace-border bg-trace-bg px-2 py-1 text-[11px] text-trace-text placeholder:text-trace-dim"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!verdict || busy}
          onClick={submit}
          className="rounded bg-trace-accent/20 px-3 py-1 text-[11px] font-semibold text-trace-accent-light transition-colors hover:bg-trace-accent/30 disabled:opacity-40"
        >
          {existing ? "Update verdict" : "Save verdict"}
        </button>
        {existing && (
          <button
            type="button"
            disabled={busy}
            onClick={() => exportGolden(existing)}
            className="rounded border border-trace-border px-3 py-1 text-[11px] font-semibold text-trace-muted transition-colors hover:text-trace-text disabled:opacity-40"
            title="Append this verdict to evals/golden as a regression case"
          >
            Export to golden
          </button>
        )}
        {status && <span className="text-[10px] text-trace-dim">{status}</span>}
      </div>
    </div>
  );
}
