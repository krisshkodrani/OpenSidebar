import { useDraftWarning } from "../draft-warning";
import { useState } from "react";
import { KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import type { CredentialStatusV1 } from "@opensidebar/shared-types";
import { accountApi } from "../../account-api";
import { EmptyState, StateBadge } from "../WorkspaceUi";
export function ProvidersSection({
  credentials,
  busy,
  act,
}: {
  credentials: CredentialStatusV1[];
  busy: boolean;
  act: (operation: () => Promise<unknown>) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const dirty = Object.values(drafts).some((value) => value.length > 0);
  useDraftWarning(dirty);
  return (
    <section className="os-panel">
      <div className="os-panel-heading">
        <div>
          <h2 className="os-section-title">
            <KeyRound size={18} aria-hidden="true" />
            Provider connections
          </h2>
          <p>Bring your own key for account-based AI requests.</p>
        </div>
      </div>
      <div className="os-panel-body">
        <p className="os-muted" style={{ fontSize: 13, marginBottom: 20 }}>
          Keys saved here are encrypted for your account. Keys used directly by
          the extension remain on that device. Adding a key does not start a
          task.
        </p>
        {!credentials.length ? (
          <EmptyState title="No providers available">
            Provider connections aren’t available for this account right now.
          </EmptyState>
        ) : (
          credentials.map((credential) => (
            <div className="os-provider-row" key={credential.provider}>
              <div className="os-provider-heading">
                <div>
                  <h3>
                    OpenRouter
                  </h3>
                  <p>
                    {credential.configured
                      ? `Encrypted · fingerprint ${credential.fingerprint ?? "unavailable"}`
                      : "No account key saved"}
                  </p>
                </div>
                <StateBadge
                  tone={
                    credential.verification === "valid"
                      ? "success"
                      : credential.verification === "invalid"
                        ? "warning"
                        : "neutral"
                  }
                >
                  {
                    {
                      valid: "Verified",
                      invalid: "Needs attention",
                      never: "Not verified",
                      unavailable: "Verification unavailable",
                    }[credential.verification]
                  }
                </StateBadge>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!drafts[credential.provider]?.trim()) return;
                  act(async () => {
                    await accountApi.saveCredential(
                      credential.provider,
                      drafts[credential.provider]!.trim(),
                    );
                    setDrafts((current) => ({
                      ...current,
                      [credential.provider]: "",
                    }));
                  });
                }}
              >
                <label htmlFor={`key-${credential.provider}`}>
                  {credential.configured ? "Replacement API key" : "API key"}
                </label>
                <div className="os-inline-form">
                  <input
                    id={`key-${credential.provider}`}
                    type="password"
                    autoComplete="off"
                    value={drafts[credential.provider] ?? ""}
                    placeholder={
                      credential.configured
                        ? "Enter a replacement key"
                        : "Enter your provider API key"
                    }
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [credential.provider]: event.target.value,
                      }))
                    }
                    disabled={busy}
                  />
                  <button
                    className="os-button os-primary"
                    disabled={busy || !drafts[credential.provider]?.trim()}
                    type="submit"
                  >
                    <ShieldCheck size={15} aria-hidden="true" />
                    {credential.configured
                      ? "Verify & replace"
                      : "Verify & save"}
                  </button>
                  {credential.configured && (
                    <button
                      type="button"
                      className="os-button os-danger-button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove the saved ${credential.provider} key? This will not revoke the key at the provider.`,
                          )
                        )
                          act(() =>
                            accountApi.deleteCredential(credential.provider),
                          );
                      }}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                      Remove
                    </button>
                  )}
                </div>
              </form>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
