import { useEffect, useRef, useState } from "react";

type OnboardingData = {
  fullName: string;
  email: string;
  phone: string;
  requestType: string;
  department: string;
  vendorName: string;
  dataAccess: string;
  accessReason: string;
  dpaCompleted: boolean;
  confirmAccuracy: boolean;
};

type OnboardingEvent = {
  type: "field_updated" | "step_changed" | "submitted";
  field?: keyof OnboardingData;
  value?: string | boolean;
  step?: number;
  at: string;
};

const initialData: OnboardingData = {
  fullName: "",
  email: "",
  phone: "",
  requestType: "",
  department: "",
  vendorName: "",
  dataAccess: "",
  accessReason: "",
  dpaCompleted: false,
  confirmAccuracy: false,
};

const sensitiveAccessValues = new Set(["Customer data", "Financial data"]);

export default function VendorOnboarding() {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<OnboardingData>(initialData);
  const [submitted, setSubmitted] = useState(false);
  const eventsRef = useRef<OnboardingEvent[]>([]);

  const requiresDataReview = sensitiveAccessValues.has(data.dataAccess);
  const canContinueContact = Boolean(
    data.fullName.trim() && data.email.includes("@") && data.phone.trim(),
  );
  const canContinueRequest = Boolean(
    data.requestType &&
      data.department &&
      data.vendorName.trim() &&
      data.dataAccess &&
      (!requiresDataReview ||
        (data.accessReason.trim() && data.dpaCompleted)),
  );
  const canSubmit = canContinueContact && canContinueRequest && data.confirmAccuracy;

  const recordEvent = (event: Omit<OnboardingEvent, "at">) => {
    eventsRef.current = [
      ...eventsRef.current,
      { ...event, at: new Date().toISOString() },
    ];
  };

  const updateField = <K extends keyof OnboardingData>(
    field: K,
    value: OnboardingData[K],
  ) => {
    recordEvent({ type: "field_updated", field, value });
    setData((current) => ({
      ...current,
      [field]: value,
      ...(field === "dataAccess" && !sensitiveAccessValues.has(String(value))
        ? { accessReason: "", dpaCompleted: false }
        : {}),
    }));
  };

  const goToStep = (nextStep: number) => {
    recordEvent({ type: "step_changed", step: nextStep });
    setStep(nextStep);
  };

  const submit = () => {
    if (!canSubmit) return;
    recordEvent({ type: "submitted" });
    const result = {
      ...data,
      submitted: true,
      reviewPath: requiresDataReview ? "Enhanced review" : "Standard review",
      events: eventsRef.current,
    };
    (window as any).vendorOnboardingResult = result;
    setSubmitted(true);
  };

  useEffect(() => {
    (window as any).vendorOnboardingDraft = {
      step,
      submitted,
      data,
      requiresDataReview,
      visibleConditionalFields: requiresDataReview
        ? ["accessReason", "dpaCompleted"]
        : [],
      events: eventsRef.current,
    };
  }, [data, requiresDataReview, step, submitted]);

  if (submitted) {
    return (
      <main className="fixture-static wizard-app">
        <section className="wizard-panel wizard-confirmation">
          <h1>Vendor request submitted</h1>
          <p>
            {data.vendorName} was sent for{" "}
            {requiresDataReview ? "enhanced review" : "standard review"}.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="fixture-static wizard-app">
      <div className="wizard-shell">
        <section className="wizard-panel" aria-labelledby="vendor-onboarding-title">
          <div className="wizard-header">
            <p className="wizard-eyebrow">Security intake</p>
            <h1 id="vendor-onboarding-title">Vendor access request</h1>
            <p className="lede">
              Complete contact, request, and review steps before routing a vendor
              for security approval.
            </p>
          </div>

          <ol className="wizard-steps" aria-label="Request progress">
            {["Contact", "Request", "Review"].map((label, index) => {
              const stepNumber = index + 1;
              return (
                <li
                  key={label}
                  className={step >= stepNumber ? "wizard-step active" : "wizard-step"}
                  aria-current={step === stepNumber ? "step" : undefined}
                >
                  <span>{stepNumber}</span>
                  {label}
                </li>
              );
            })}
          </ol>

          {step === 1 && (
            <form
              aria-label="Requester contact"
              onSubmit={(event) => {
                event.preventDefault();
                if (canContinueContact) goToStep(2);
              }}
            >
              <h2>Requester contact</h2>
              <div className="wizard-field-grid">
                <div className="field">
                  <label htmlFor="vendor-full-name">Full name</label>
                  <input
                    id="vendor-full-name"
                    name="fullName"
                    autoComplete="name"
                    value={data.fullName}
                    onChange={(event) => updateField("fullName", event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="vendor-email">Email</label>
                  <input
                    id="vendor-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={data.email}
                    onChange={(event) => updateField("email", event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="vendor-phone">Phone</label>
                  <input
                    id="vendor-phone"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    value={data.phone}
                    onChange={(event) => updateField("phone", event.target.value)}
                  />
                </div>
              </div>
              <div className="wizard-actions">
                <button className="btn btn-primary" type="submit" disabled={!canContinueContact}>
                  Continue
                </button>
              </div>
            </form>
          )}

          {step === 2 && (
            <form
              aria-label="Vendor request details"
              onSubmit={(event) => {
                event.preventDefault();
                if (canContinueRequest) goToStep(3);
              }}
            >
              <h2>Request details</h2>
              <div className="wizard-field-grid">
                <div className="field">
                  <label htmlFor="vendor-request-type">Request type</label>
                  <select
                    id="vendor-request-type"
                    name="requestType"
                    value={data.requestType}
                    onChange={(event) => updateField("requestType", event.target.value)}
                  >
                    <option value="">Choose request type</option>
                    <option value="Software vendor">Software vendor</option>
                    <option value="Consulting partner">Consulting partner</option>
                    <option value="Contractor access">Contractor access</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="vendor-department">Department</label>
                  <select
                    id="vendor-department"
                    name="department"
                    value={data.department}
                    onChange={(event) => updateField("department", event.target.value)}
                  >
                    <option value="">Choose department</option>
                    <option value="Finance">Finance</option>
                    <option value="Operations">Operations</option>
                    <option value="Product">Product</option>
                    <option value="Security">Security</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="vendor-name">Vendor name</label>
                  <input
                    id="vendor-name"
                    name="vendorName"
                    value={data.vendorName}
                    onChange={(event) => updateField("vendorName", event.target.value)}
                  />
                </div>
              </div>

              <fieldset className="wizard-choice-group">
                <legend>Data access</legend>
                {["No sensitive data", "Customer data", "Financial data"].map(
                  (option) => (
                    <label key={option}>
                      <input
                        type="radio"
                        name="dataAccess"
                        value={option}
                        checked={data.dataAccess === option}
                        onChange={() => updateField("dataAccess", option)}
                      />
                      {option}
                    </label>
                  ),
                )}
              </fieldset>

              {requiresDataReview && (
                <div className="wizard-conditional" role="group" aria-label="Sensitive data review">
                  <div className="field">
                    <label htmlFor="vendor-access-reason">Access reason</label>
                    <textarea
                      id="vendor-access-reason"
                      name="accessReason"
                      rows={3}
                      value={data.accessReason}
                      onChange={(event) =>
                        updateField("accessReason", event.target.value)
                      }
                    />
                  </div>
                  <label className="wizard-check" htmlFor="vendor-dpa-completed">
                    <input
                      id="vendor-dpa-completed"
                      name="dpaCompleted"
                      type="checkbox"
                      checked={data.dpaCompleted}
                      onChange={(event) =>
                        updateField("dpaCompleted", event.target.checked)
                      }
                    />
                    Data processing agreement completed
                  </label>
                </div>
              )}

              <div className="wizard-actions">
                <button className="btn btn-ghost" type="button" onClick={() => goToStep(1)}>
                  Back
                </button>
                <button className="btn btn-primary" type="submit" disabled={!canContinueRequest}>
                  Continue to review
                </button>
              </div>
            </form>
          )}

          {step === 3 && (
            <form
              aria-label="Review and submit vendor request"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <h2>Review request</h2>
              <dl className="wizard-review">
                <div>
                  <dt>Requester</dt>
                  <dd>{data.fullName}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{data.email}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{data.phone}</dd>
                </div>
                <div>
                  <dt>Vendor</dt>
                  <dd>{data.vendorName}</dd>
                </div>
                <div>
                  <dt>Request type</dt>
                  <dd>{data.requestType}</dd>
                </div>
                <div>
                  <dt>Department</dt>
                  <dd>{data.department}</dd>
                </div>
                <div>
                  <dt>Data access</dt>
                  <dd>{data.dataAccess}</dd>
                </div>
                {requiresDataReview && (
                  <>
                    <div>
                      <dt>Access reason</dt>
                      <dd>{data.accessReason}</dd>
                    </div>
                    <div>
                      <dt>Review path</dt>
                      <dd>Enhanced review</dd>
                    </div>
                  </>
                )}
              </dl>
              <label className="wizard-check" htmlFor="vendor-confirm-accuracy">
                <input
                  id="vendor-confirm-accuracy"
                  name="confirmAccuracy"
                  type="checkbox"
                  checked={data.confirmAccuracy}
                  onChange={(event) =>
                    updateField("confirmAccuracy", event.target.checked)
                  }
                />
                I confirm this request is accurate
              </label>
              <div className="wizard-actions">
                <button className="btn btn-ghost" type="button" onClick={() => goToStep(2)}>
                  Back
                </button>
                <button className="btn btn-primary" type="submit" disabled={!canSubmit}>
                  Submit request
                </button>
              </div>
            </form>
          )}
        </section>

        <aside className="wizard-sidebar" aria-label="Request status">
          <h2>Routing</h2>
          <dl>
            <div>
              <dt>Current step</dt>
              <dd>{step} of 3</dd>
            </div>
            <div>
              <dt>Data review</dt>
              <dd>{requiresDataReview ? "Required" : "Not required"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{submitted ? "Submitted" : "Draft"}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </main>
  );
}
