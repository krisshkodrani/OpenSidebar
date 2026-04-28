import React, { useEffect, useState } from "react";
import { fetchSkillContract, type SkillContract } from "../../api";
import Badge from "../Badge";
import LoadingSpinner from "../LoadingSpinner";
import ErrorBanner from "../ErrorBanner";

interface SkillDetailProps {
  skillId: string;
  onBack?: () => void;
}

export default function SkillDetail({ skillId, onBack }: SkillDetailProps) {
  const [skill, setSkill] = useState<SkillContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSkillContract(skillId)
      .then((data) => {
        if (!cancelled) setSkill(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load skill");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skillId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner message="Loading skill..." />
      </div>
    );
  }

  if (error || !skill) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-5">
        <ErrorBanner
          message={error || "Skill not found"}
          hint="Ensure the log server is running (npm run logs)"
        />
        {onBack && (
          <button
            onClick={onBack}
            className="mt-4 text-sm text-trace-accent hover:underline"
          >
            &larr; Back
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="text-sm text-trace-muted hover:text-trace-accent-light transition-colors"
            >
              &larr; Back
            </button>
          )}
        </div>

        <div className="bg-trace-panel border border-trace-border rounded-lg p-5">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <h1 className="text-lg font-semibold text-trace-text">
              {skill.name}
            </h1>
            <Badge variant={skill.maturity === "active" ? "completed" : "type"}>
              {skill.maturity}
            </Badge>
          </div>
          <div className="text-sm text-trace-muted mb-3">{skill.id}</div>
          <p className="text-sm text-trace-text leading-relaxed">
            {skill.description}
          </p>

          {skill.tags && skill.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {skill.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 text-[10px] rounded bg-trace-bg border border-trace-border text-trace-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Triggers */}
        {skill.triggers && skill.triggers.length > 0 && (
          <div className="bg-trace-panel border border-trace-border rounded-lg p-5">
            <h2 className="text-[11px] text-trace-muted uppercase tracking-wide mb-3">
              Triggers
            </h2>
            <ul className="space-y-1.5">
              {skill.triggers.map((trigger, i) => (
                <li
                  key={i}
                  className="text-sm text-trace-text flex items-start gap-2"
                >
                  <span className="text-trace-accent mt-0.5">•</span>
                  {trigger}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Tools */}
        {skill.preferredTools?.length || skill.discouragedTools?.length ? (
          <div className="bg-trace-panel border border-trace-border rounded-lg p-5">
            <h2 className="text-[11px] text-trace-muted uppercase tracking-wide mb-3">
              Tool Policy
            </h2>
            {skill.preferredTools && skill.preferredTools.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] text-trace-muted uppercase tracking-wider mb-1.5">
                  Preferred
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {skill.preferredTools.map((tool) => (
                    <span
                      key={tool}
                      className="px-1.5 py-0.5 text-[10px] rounded bg-brand-live/10 text-brand-live font-medium"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {skill.discouragedTools && skill.discouragedTools.length > 0 && (
              <div>
                <div className="text-[10px] text-trace-muted uppercase tracking-wider mb-1.5">
                  Discouraged
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {skill.discouragedTools.map((tool) => (
                    <span
                      key={tool}
                      className="px-1.5 py-0.5 text-[10px] rounded bg-state-warning/10 text-state-warning font-medium"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* Notes */}
        {skill.notes && skill.notes.length > 0 && (
          <div className="bg-trace-panel border border-trace-border rounded-lg p-5">
            <h2 className="text-[11px] text-trace-muted uppercase tracking-wide mb-3">
              Notes
            </h2>
            <ul className="space-y-2">
              {skill.notes.map((note, i) => (
                <li
                  key={i}
                  className="text-sm text-trace-text flex items-start gap-2"
                >
                  <span className="text-trace-accent mt-0.5">•</span>
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Procedure */}
        {skill.procedureMarkdown && (
          <div className="bg-trace-panel border border-trace-border rounded-lg p-5">
            <h2 className="text-[11px] text-trace-muted uppercase tracking-wide mb-3">
              Procedure
            </h2>
            <div className="text-sm text-trace-text leading-relaxed whitespace-pre-wrap">
              {skill.procedureMarkdown}
            </div>
          </div>
        )}

        {/* Required Evidence */}
        {skill.requiredEvidence && skill.requiredEvidence.length > 0 && (
          <div className="bg-trace-panel border border-trace-border rounded-lg p-5">
            <h2 className="text-[11px] text-trace-muted uppercase tracking-wide mb-3">
              Required Evidence
            </h2>
            <ul className="space-y-1.5">
              {skill.requiredEvidence.map((evidence, i) => (
                <li
                  key={i}
                  className="text-sm text-trace-text flex items-start gap-2"
                >
                  <span className="text-trace-accent mt-0.5">•</span>
                  {evidence}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Common Failures */}
        {skill.commonFailures && skill.commonFailures.length > 0 && (
          <div className="bg-trace-panel border border-trace-border rounded-lg p-5">
            <h2 className="text-[11px] text-trace-muted uppercase tracking-wide mb-3">
              Common Failures
            </h2>
            <div className="space-y-3">
              {skill.commonFailures.map((failure, i) => (
                <div key={i} className="border-l-2 border-state-warning pl-3">
                  <div className="text-sm text-state-warning font-medium mb-1">
                    {failure.signal}
                  </div>
                  <div className="text-sm text-trace-muted">
                    {failure.recovery}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Execution Contract */}
        {skill.executionContract && (
          <div className="bg-trace-panel border border-trace-border rounded-lg p-5">
            <h2 className="text-[11px] text-trace-muted uppercase tracking-wide mb-3">
              Execution Contract
            </h2>
            <div className="space-y-4">
              {skill.executionContract.sequencing && (
                <div>
                  <div className="text-[10px] text-trace-muted uppercase tracking-wider mb-1.5">
                    Sequencing
                  </div>
                  <ul className="space-y-1">
                    {skill.executionContract.sequencing.map((item, i) => (
                      <li
                        key={i}
                        className="text-sm text-trace-text flex items-start gap-2"
                      >
                        <span className="text-trace-accent mt-0.5">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {skill.executionContract.toolDiscipline && (
                <div>
                  <div className="text-[10px] text-trace-muted uppercase tracking-wider mb-1.5">
                    Tool Discipline
                  </div>
                  <ul className="space-y-1">
                    {skill.executionContract.toolDiscipline.map((item, i) => (
                      <li
                        key={i}
                        className="text-sm text-trace-text flex items-start gap-2"
                      >
                        <span className="text-trace-accent mt-0.5">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {skill.executionContract.completionChecks && (
                <div>
                  <div className="text-[10px] text-trace-muted uppercase tracking-wider mb-1.5">
                    Completion Checks
                  </div>
                  <ul className="space-y-1">
                    {skill.executionContract.completionChecks.map((item, i) => (
                      <li
                        key={i}
                        className="text-sm text-trace-text flex items-start gap-2"
                      >
                        <span className="text-trace-accent mt-0.5">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {skill.executionContract.failureRecovery && (
                <div>
                  <div className="text-[10px] text-trace-muted uppercase tracking-wider mb-1.5">
                    Failure Recovery
                  </div>
                  <ul className="space-y-1">
                    {skill.executionContract.failureRecovery.map((item, i) => (
                      <li
                        key={i}
                        className="text-sm text-trace-text flex items-start gap-2"
                      >
                        <span className="text-trace-accent mt-0.5">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
