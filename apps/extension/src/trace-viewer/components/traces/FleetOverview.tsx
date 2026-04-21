import React, { useMemo } from "react";
import {
  computeFleetAnalytics,
  computeRegressionSummary,
  computeSkillPolicyRegressionSummary,
  FLEET_LENSES,
  isLensActive,
} from "../../analytics";
import { useStore } from "../../store";
import { formatCost, formatDuration } from "../../utils";

interface FleetOverviewProps {
  onFiltersChanged: () => void;
}

export default function FleetOverview({ onFiltersChanged }: FleetOverviewProps) {
  const sessions = useStore((s) => s.sessions);
  const runGroups = useStore((s) => s.runGroups);
  const filters = useStore((s) => s.filters);
  const setFilter = useStore((s) => s.setFilter);

  const analytics = useMemo(
    () => computeFleetAnalytics(sessions, runGroups),
    [sessions, runGroups],
  );
  const regression = useMemo(
    () => computeRegressionSummary(sessions),
    [sessions],
  );
  const skillRegression = useMemo(
    () => computeSkillPolicyRegressionSummary(sessions),
    [sessions],
  );

  const applyLens = (key: string) => {
    const lens = FLEET_LENSES.find((item) => item.key === key);
    if (!lens) return;
    setFilter("outcome", lens.filters.outcome ?? "all");
    setFilter("mode", lens.filters.mode ?? "all");
    setFilter("tier", lens.filters.tier ?? "all");
    onFiltersChanged();
  };

  return (
    <div className="px-5 py-4 border-b border-trace-border bg-[linear-gradient(180deg,rgba(124,58,237,0.07),rgba(12,16,22,0))] shrink-0">
      <div className="grid grid-cols-[repeat(4,minmax(0,1fr))] gap-3">
        <OverviewCard
          label="Success Rate"
          value={`${Math.round(analytics.successRate * 100)}%`}
          hint={`${analytics.errorSessions} errors`}
        />
        <OverviewCard
          label="Avg Turns"
          value={analytics.averageTurns.toFixed(1)}
          hint={`${analytics.maxTurnsSessions} max-turn runs`}
        />
        <OverviewCard
          label="Avg Duration"
          value={formatDuration(analytics.averageDurationMs)}
          hint={`${runGroups.length} runs`}
        />
        <OverviewCard
          label="Avg Cost"
          value={formatCost(analytics.averageCost) || "$0"}
          hint={`${sessions.length} sessions`}
        />
      </div>

      <div className="grid grid-cols-[1.2fr,1fr,1fr,1fr] gap-3 mt-3">
        <PanelCard title="Operational Lenses">
          <div className="flex gap-2 flex-wrap">
            {FLEET_LENSES.map((lens) => (
              <button
                key={lens.key}
                onClick={() => applyLens(lens.key)}
                className={`px-2.5 py-1.5 rounded border text-[11px] transition-colors ${
                  isLensActive(filters, lens)
                    ? "border-trace-accent/40 bg-trace-accent/10 text-trace-accent-light"
                    : "border-trace-border text-trace-muted hover:text-trace-text"
                }`}
                title={lens.description}
              >
                {lens.label}
              </button>
            ))}
          </div>
        </PanelCard>
        <PanelCard title="Failure Hotspots">
          {analytics.topFailingDomains.length === 0 ? (
            <div className="text-[11px] text-trace-dim">No failure hotspots</div>
          ) : (
            analytics.topFailingDomains.map((item) => (
              <RollupRow key={item.domain} label={item.domain} value={String(item.count)} />
            ))
          )}
        </PanelCard>
        <PanelCard title="Model Mix">
          {analytics.topModels.length === 0 ? (
            <div className="text-[11px] text-trace-dim">No model usage</div>
          ) : (
            analytics.topModels.map((item) => (
              <RollupRow key={item.model} label={item.model} value={String(item.count)} />
            ))
          )}
        </PanelCard>
        <PanelCard title="Skill Policy">
          <RollupRow
            label="Guided sessions"
            value={String(analytics.skillGuidedSessions)}
          />
          <RollupRow
            label="Preferred picks"
            value={`${Math.round(analytics.preferredToolSelectionRate * 100)}%`}
          />
          <RollupRow
            label="Discouraged picks"
            value={`${Math.round(analytics.discouragedToolSelectionRate * 100)}%`}
          />
          {analytics.topSkillPolicies.length === 0 ? (
            <div className="text-[11px] text-trace-dim">No skill policy data</div>
          ) : (
            analytics.topSkillPolicies.map((item) => (
              <RollupRow
                key={item.skillId}
                label={`${item.skillId} (${item.sessions})`}
                value={`${Math.round(item.preferredRate * 100)}%`}
              />
            ))
          )}
          <div className="pt-2 mt-2 border-t border-trace-border/50">
            <div className="text-[10px] uppercase tracking-[0.18em] text-trace-dim mb-1.5">
              Watchlist
            </div>
            {analytics.skillPolicyAlerts.length === 0 ? (
              <div className="text-[11px] text-trace-dim">No skill policy warnings</div>
            ) : (
              analytics.skillPolicyAlerts.map((item) => (
                <div
                  key={item.skillId}
                  className="rounded border border-trace-border/70 bg-black/10 px-2 py-1.5"
                >
                  <div className="flex items-center gap-2 text-[11px]">
                    <span
                      className={
                        item.severity === "critical"
                          ? "text-[#fca5a5] font-semibold"
                          : "text-[#fcd34d] font-semibold"
                      }
                    >
                      {item.severity}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-trace-subtle">
                      {item.skillId}
                    </span>
                    <span className="font-mono text-trace-text">
                      {item.sessions}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-trace-dim">
                    {item.reason}. Preferred {Math.round(item.preferredRate * 100)}%, discouraged{" "}
                    {Math.round(item.discouragedRate * 100)}%.
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="pt-2 mt-2 border-t border-trace-border/50">
            <div className="text-[10px] uppercase tracking-[0.18em] text-trace-dim mb-1.5">
              Vs Prev 7d
            </div>
            {!skillRegression || skillRegression.changes.length === 0 ? (
              <div className="text-[11px] text-trace-dim">No skill regression data</div>
            ) : (
              skillRegression.changes.map((item) => (
                <div
                  key={item.skillId}
                  className="rounded border border-trace-border/70 bg-black/10 px-2 py-1.5"
                >
                  <div className="flex items-center gap-2 text-[11px]">
                    <span
                      className={
                        item.trend === "worse"
                          ? "text-[#fca5a5] font-semibold"
                          : item.trend === "better"
                            ? "text-[#86efac] font-semibold"
                            : item.trend === "low-signal"
                              ? "text-[#fcd34d] font-semibold"
                              : item.trend === "new"
                                ? "text-[#93c5fd] font-semibold"
                                : item.trend === "inactive"
                                  ? "text-trace-muted font-semibold"
                            : "text-trace-dim font-semibold"
                      }
                    >
                      {item.trend}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-trace-subtle">
                      {item.skillId}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-trace-dim">
                    {item.trend === "new" ? (
                      <>
                        Active only in {skillRegression.currentLabel}. Preferred{" "}
                        {Math.round(item.currentPreferredRate * 100)}%, discouraged{" "}
                        {Math.round(item.currentDiscouragedRate * 100)}%.
                      </>
                    ) : item.trend === "inactive" ? (
                      <>
                        Active only in {skillRegression.previousLabel}. Preferred{" "}
                        {Math.round(item.previousPreferredRate * 100)}%, discouraged{" "}
                        {Math.round(item.previousDiscouragedRate * 100)}%.
                      </>
                    ) : item.trend === "low-signal" ? (
                      <>
                        Low signal. {skillRegression.currentLabel} {item.currentSessions} sessions /{" "}
                        {item.currentSelections} picks vs {skillRegression.previousLabel}{" "}
                        {item.previousSessions} sessions / {item.previousSelections} picks.
                      </>
                    ) : (
                      <>
                        {skillRegression.currentLabel} preferred{" "}
                        {Math.round(item.currentPreferredRate * 100)}%, discouraged{" "}
                        {Math.round(item.currentDiscouragedRate * 100)}% vs{" "}
                        {skillRegression.previousLabel} preferred{" "}
                        {Math.round(item.previousPreferredRate * 100)}%, discouraged{" "}
                        {Math.round(item.previousDiscouragedRate * 100)}%.
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </PanelCard>
        <PanelCard title="Regression Watch">
          {!regression ? (
            <div className="text-[11px] text-trace-dim">Not enough history</div>
          ) : (
            <>
              <div className="grid grid-cols-[1fr,auto,auto] gap-2 text-[10px] uppercase tracking-[0.16em] text-trace-dim pb-1 border-b border-trace-border/50">
                <span>Metric</span>
                <span>{regression.currentLabel}</span>
                <span>{regression.previousLabel}</span>
              </div>
              <RegressionRow
                label="Sessions"
                current={regression.current.sessionCount}
                previous={regression.previous.sessionCount}
              />
              <RegressionRow
                label="Success"
                current={`${Math.round(regression.current.successRate * 100)}%`}
                previous={`${Math.round(regression.previous.successRate * 100)}%`}
              />
              <RegressionRow
                label="Avg turns"
                current={regression.current.averageTurns.toFixed(1)}
                previous={regression.previous.averageTurns.toFixed(1)}
              />
              <RegressionRow
                label="Avg cost"
                current={formatCost(regression.current.averageCost) || "$0"}
                previous={formatCost(regression.previous.averageCost) || "$0"}
              />
            </>
          )}
        </PanelCard>
      </div>
    </div>
  );
}

function OverviewCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded border border-trace-border bg-trace-panel px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.22em] text-trace-muted">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-trace-text">{value}</div>
      <div className="mt-1 text-[10px] text-trace-dim">{hint}</div>
    </div>
  );
}

function PanelCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-trace-border bg-trace-panel px-3 py-3 min-w-0">
      <div className="text-[10px] uppercase tracking-[0.22em] text-trace-muted mb-2">
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function RollupRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="min-w-0 flex-1 truncate text-trace-subtle">{label}</span>
      <span className="font-mono text-trace-text">{value}</span>
    </div>
  );
}

function RegressionRow({
  label,
  current,
  previous,
}: {
  label: string;
  current: string | number;
  previous: string | number;
}) {
  const currentText = String(current);
  const previousText = String(previous);
  const changed = currentText !== previousText;
  return (
    <div className="grid grid-cols-[1fr,auto,auto] gap-2 text-[11px] items-center">
      <span className="text-trace-subtle">{label}</span>
      <span className={changed ? "text-trace-text font-semibold" : "text-trace-dim"}>
        {currentText}
      </span>
      <span className="text-trace-dim">{previousText}</span>
    </div>
  );
}
