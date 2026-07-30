import React from "react";
import type { FleetTelemetryEnvelopeV1 } from "@observability-schema";
import {
  clearFleetTelemetrySettingsData,
  getFleetTelemetrySettingsSnapshot,
  updateFleetTelemetryConsent,
} from "../../fleet-telemetry-settings";

const EXAMPLE_PAYLOAD: FleetTelemetryEnvelopeV1 = {
  schemaVersion: 1,
  eventId: "00000000-0000-4000-8000-000000000000",
  extension: { version: "0.7.0", channel: "dev" },
  environment: { browserMajor: 140, osFamily: "other" },
  runtime: {
    provider: "other",
    executorModel: "other",
    plannerModel: "other",
    judgeModel: "other",
    taskShape: "single_interaction",
  },
  execution: {
    plannerStepCount: 1,
    turnCount: 2,
    durationBucket: "5s_to_15s",
    toolCounts: {
      click: { attempted: 1, failed: 0 },
      done: { attempted: 1, failed: 0 },
    },
  },
  completion: {
    doneCallCount: 1,
    firstDoneCandidateTurn: 2,
    acceptedDoneTurn: 2,
    acceptedSource: "model_done",
    rejectedDoneCount: 0,
    rejectionReasons: [],
    evidenceTypes: ["target_state_observed"],
    firstSatisfiedEvidenceTurn: 1,
    turnsAfterFirstSatisfiedEvidence: 1,
  },
  result: {
    outcome: "completed",
    terminalReason: "completion_accepted",
    errorCodes: [],
  },
};

type PayloadView = "example" | "last" | null;

export function FleetTelemetrySettings() {
  const telemetryId = React.useId();
  const [enabled, setEnabled] = React.useState(false);
  const [requiresRenewal, setRequiresRenewal] = React.useState(false);
  const [queuedCount, setQueuedCount] = React.useState(0);
  const [lastPayload, setLastPayload] =
    React.useState<FleetTelemetryEnvelopeV1 | null>(null);
  const [payloadView, setPayloadView] = React.useState<PayloadView>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const snapshot = await getFleetTelemetrySettingsSnapshot();
    setEnabled(snapshot.enabled);
    setRequiresRenewal(snapshot.requiresRenewal);
    setQueuedCount(snapshot.queuedCount);
    setLastPayload(snapshot.lastPayload);
  }, []);

  React.useEffect(() => {
    let mounted = true;
    void refresh()
      .catch(() => {
        if (mounted) setError("Local telemetry settings could not be loaded.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [refresh]);

  const updateConsent = async (nextEnabled: boolean) => {
    setError(null);
    try {
      await updateFleetTelemetryConsent(nextEnabled);
      await refresh();
      if (!nextEnabled) setPayloadView(null);
    } catch {
      setError("The telemetry preference could not be saved.");
    }
  };

  const clearLocalData = async () => {
    setError(null);
    try {
      await clearFleetTelemetrySettingsData();
      await refresh();
      setPayloadView(null);
    } catch {
      setError("Local telemetry data could not be cleared.");
    }
  };

  const displayedPayload =
    payloadView === "example"
      ? EXAMPLE_PAYLOAD
      : payloadView === "last"
        ? lastPayload
        : null;

  return (
    <section className="space-y-3 rounded-md border border-warm-200 p-3 dark:border-warm-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label
            htmlFor={telemetryId}
            className="text-sm font-medium dark:text-warm-300"
          >
            Optional reliability telemetry
          </label>
          <p className="mt-1 text-xs text-warm-500 dark:text-warm-400">
            Share a 5% sample of coarse agent reliability summaries to help
            diagnose completion loops and failures.
          </p>
        </div>
        <input
          id={telemetryId}
          type="checkbox"
          checked={enabled}
          disabled={loading}
          onChange={(event) => void updateConsent(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded text-primary-600"
        />
      </div>

      <div className="rounded bg-warm-100 p-2 text-[11px] leading-relaxed text-warm-600 dark:bg-warm-800 dark:text-warm-300">
        Includes extension and coarse environment versions, model families,
        action counts, timing buckets, completion decisions, evidence
        categories, and outcomes. Never includes task text, websites, page
        content, screenshots, form data, API keys, conversations, or a
        persistent identifier.
      </div>

      <p className="text-[11px] text-warm-400 dark:text-warm-500">
        {enabled
          ? `On | ${queuedCount} queued locally`
          : requiresRenewal
            ? "Off | review and opt in again after the disclosure update"
            : "Off by default"}
        {" | "}
        Uploading is not enabled in this build.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            setPayloadView((current) =>
              current === "example" ? null : "example",
            )
          }
          className="rounded border border-warm-300 px-2 py-1 text-xs text-warm-600 hover:bg-warm-100 dark:border-warm-700 dark:text-warm-300 dark:hover:bg-warm-800"
        >
          View example payload
        </button>
        <button
          type="button"
          disabled={!lastPayload}
          onClick={() =>
            setPayloadView((current) =>
              current === "last" ? null : "last",
            )
          }
          className="rounded border border-warm-300 px-2 py-1 text-xs text-warm-600 hover:bg-warm-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-warm-700 dark:text-warm-300 dark:hover:bg-warm-800"
        >
          View last payload
        </button>
        <button
          type="button"
          disabled={queuedCount === 0 && !lastPayload}
          onClick={() => void clearLocalData()}
          className="rounded border border-warm-300 px-2 py-1 text-xs text-warm-600 hover:bg-warm-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-warm-700 dark:text-warm-300 dark:hover:bg-warm-800"
        >
          Clear local data
        </button>
      </div>

      {displayedPayload ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-warm-950 p-2 text-[10px] text-warm-100">
          {JSON.stringify(displayedPayload, null, 2)}
        </pre>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}
