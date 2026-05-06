import { useEffect, useRef, useState } from "react";

type PartnerRegistrationData = {
  fullName: string;
  email: string;
  phone: string;
  company: string;
  role: string;
  team: string;
  inviteCode: string;
  termsAccepted: boolean;
};

type PartnerRegistrationErrors = Partial<
  Record<keyof PartnerRegistrationData, string>
>;

type PartnerRegistrationEvent = {
  type: "field_updated" | "submit_attempted" | "validation_failed" | "submitted";
  field?: keyof PartnerRegistrationData;
  value?: string | boolean;
  errors?: PartnerRegistrationErrors;
  at: string;
};

const initialData: PartnerRegistrationData = {
  fullName: "",
  email: "",
  phone: "",
  company: "",
  role: "",
  team: "",
  inviteCode: "",
  termsAccepted: false,
};

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits === "14155550134") return "+1 415 555 0134";
  if (digits === "4155550134") return "+1 415 555 0134";
  return value.trim();
}

function validate(data: PartnerRegistrationData): PartnerRegistrationErrors {
  const errors: PartnerRegistrationErrors = {};
  const phoneDigits = data.phone.replace(/\D/g, "");

  if (!data.fullName.trim()) {
    errors.fullName = "Full name is required.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
    errors.email = "Enter a valid email address.";
  }
  if (!data.phone.trim().startsWith("+") || phoneDigits.length < 11) {
    errors.phone =
      "Phone must include a country code, for example +1 415 555 0134.";
  }
  if (!data.company.trim()) {
    errors.company = "Company is required.";
  }
  if (!data.role.trim()) {
    errors.role = "Role is required.";
  }
  if (!data.team.trim()) {
    errors.team = "Team is required.";
  }
  if (data.inviteCode.trim() !== "PN-4821") {
    errors.inviteCode = "Invite code must match PN-4821 exactly.";
  }
  if (!data.termsAccepted) {
    errors.termsAccepted = "You must accept the partner terms.";
  }

  return errors;
}

export default function PartnerRegistration() {
  const [data, setData] = useState<PartnerRegistrationData>(initialData);
  const [errors, setErrors] = useState<PartnerRegistrationErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [attemptCount, setAttemptCount] = useState(0);
  const eventsRef = useRef<PartnerRegistrationEvent[]>([]);

  const recordEvent = (
    event: Omit<PartnerRegistrationEvent, "at">,
  ): void => {
    eventsRef.current = [
      ...eventsRef.current,
      { ...event, at: new Date().toISOString() },
    ];
  };

  const updateField = <K extends keyof PartnerRegistrationData>(
    field: K,
    value: PartnerRegistrationData[K],
  ) => {
    recordEvent({ type: "field_updated", field, value });
    setData((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const submit = () => {
    recordEvent({ type: "submit_attempted" });
    const nextErrors = validate(data);
    setAttemptCount((count) => count + 1);

    if (Object.keys(nextErrors).length > 0) {
      recordEvent({ type: "validation_failed", errors: nextErrors });
      setErrors(nextErrors);
      return;
    }

    recordEvent({ type: "submitted" });
    const result = {
      ...data,
      phone: normalizePhone(data.phone),
      inviteCode: data.inviteCode.trim().toUpperCase(),
      submitted: true,
      attemptCount: attemptCount + 1,
      events: eventsRef.current,
    };
    (window as any).partnerRegistrationResult = result;
    setSubmitted(true);
  };

  useEffect(() => {
    (window as any).partnerRegistrationDraft = {
      data,
      errors,
      attemptCount,
      submitted,
      events: eventsRef.current,
    };
  }, [attemptCount, data, errors, submitted]);

  if (submitted) {
    return (
      <main className="fixture-static wizard-app">
        <section className="wizard-panel wizard-confirmation">
          <p className="wizard-eyebrow">Partner portal</p>
          <h1>Registration received</h1>
          <p>Sam Rivera is registered for Northstar Analytics.</p>
          <dl className="wizard-review" aria-label="Registration summary">
            <div>
              <dt>Email</dt>
              <dd>{data.email}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{normalizePhone(data.phone)}</dd>
            </div>
            <div>
              <dt>Invite code</dt>
              <dd>{data.inviteCode.trim().toUpperCase()}</dd>
            </div>
          </dl>
        </section>
      </main>
    );
  }

  return (
    <main className="fixture-static wizard-app">
      <div className="wizard-shell validation-shell">
        <section className="wizard-panel" aria-labelledby="partner-registration-title">
          <div className="wizard-header">
            <p className="wizard-eyebrow">Partner portal</p>
            <h1 id="partner-registration-title">Partner registration</h1>
            <p className="lede">
              Register a partner contact. Some policy checks run after the
              first submit attempt.
            </p>
          </div>

          {Object.keys(errors).length > 0 && (
            <div className="validation-summary" role="alert" aria-label="Validation errors">
              <h2>Review the highlighted fields</h2>
              <ul>
                {Object.entries(errors).map(([field, message]) => (
                  <li key={field}>{message}</li>
                ))}
              </ul>
            </div>
          )}

          <form
            aria-label="Partner registration form"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="wizard-field-grid">
              <div className="field">
                <label htmlFor="partner-full-name">Full name</label>
                <input
                  id="partner-full-name"
                  name="fullName"
                  autoComplete="name"
                  aria-invalid={Boolean(errors.fullName)}
                  aria-describedby={errors.fullName ? "partner-full-name-error" : undefined}
                  value={data.fullName}
                  onChange={(event) => updateField("fullName", event.target.value)}
                />
                {errors.fullName && (
                  <p className="field-error" id="partner-full-name-error">
                    {errors.fullName}
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="partner-email">Email</label>
                <input
                  id="partner-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? "partner-email-error" : undefined}
                  value={data.email}
                  onChange={(event) => updateField("email", event.target.value)}
                />
                {errors.email && (
                  <p className="field-error" id="partner-email-error">
                    {errors.email}
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="partner-phone">Phone</label>
                <input
                  id="partner-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={errors.phone ? "partner-phone-error" : undefined}
                  value={data.phone}
                  onChange={(event) => updateField("phone", event.target.value)}
                />
                {errors.phone && (
                  <p className="field-error" id="partner-phone-error">
                    {errors.phone}
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="partner-company">Company</label>
                <input
                  id="partner-company"
                  name="company"
                  aria-invalid={Boolean(errors.company)}
                  aria-describedby={errors.company ? "partner-company-error" : undefined}
                  value={data.company}
                  onChange={(event) => updateField("company", event.target.value)}
                />
                {errors.company && (
                  <p className="field-error" id="partner-company-error">
                    {errors.company}
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="partner-role">Role</label>
                <input
                  id="partner-role"
                  name="role"
                  aria-invalid={Boolean(errors.role)}
                  aria-describedby={errors.role ? "partner-role-error" : undefined}
                  value={data.role}
                  onChange={(event) => updateField("role", event.target.value)}
                />
                {errors.role && (
                  <p className="field-error" id="partner-role-error">
                    {errors.role}
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="partner-team">Team</label>
                <input
                  id="partner-team"
                  name="team"
                  aria-invalid={Boolean(errors.team)}
                  aria-describedby={errors.team ? "partner-team-error" : undefined}
                  value={data.team}
                  onChange={(event) => updateField("team", event.target.value)}
                />
                {errors.team && (
                  <p className="field-error" id="partner-team-error">
                    {errors.team}
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="partner-invite-code">Invite code</label>
                <input
                  id="partner-invite-code"
                  name="inviteCode"
                  aria-invalid={Boolean(errors.inviteCode)}
                  aria-describedby={errors.inviteCode ? "partner-invite-code-error" : undefined}
                  value={data.inviteCode}
                  onChange={(event) => updateField("inviteCode", event.target.value)}
                />
                {errors.inviteCode && (
                  <p className="field-error" id="partner-invite-code-error">
                    {errors.inviteCode}
                  </p>
                )}
              </div>
            </div>

            <label className="wizard-check validation-terms" htmlFor="partner-terms">
              <input
                id="partner-terms"
                name="termsAccepted"
                type="checkbox"
                checked={data.termsAccepted}
                aria-invalid={Boolean(errors.termsAccepted)}
                onChange={(event) =>
                  updateField("termsAccepted", event.target.checked)
                }
              />
              I accept the partner portal terms
            </label>
            {errors.termsAccepted && (
              <p className="field-error" id="partner-terms-error">
                {errors.termsAccepted}
              </p>
            )}

            <div className="wizard-actions">
              <button className="btn btn-primary" type="submit">
                Submit registration
              </button>
            </div>
          </form>
        </section>

        <aside className="wizard-sidebar" aria-label="Registration policy">
          <h2>Policy checks</h2>
          <dl>
            <div>
              <dt>Attempts</dt>
              <dd>{attemptCount}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{submitted ? "Submitted" : "Draft"}</dd>
            </div>
            <div>
              <dt>Validation</dt>
              <dd>{Object.keys(errors).length > 0 ? "Needs attention" : "Ready"}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </main>
  );
}
