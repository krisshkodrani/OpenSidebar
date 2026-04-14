import { useState } from "react";

export default function MultiStepForm() {
  const [step, setStep] = useState(1);

  // Step 1: Personal Info
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // Step 2: Preferences
  const [category, setCategory] = useState("");
  const [company, setCompany] = useState("");
  const [budget, setBudget] = useState("");
  const [requirements, setRequirements] = useState("");

  // Step 3: Review & Submit
  const [confirmed, setConfirmed] = useState(false);

  // Result
  const [refNumber, setRefNumber] = useState("");

  const canProceed1 = name.length > 0 && email.includes("@") && phone.length > 0;
  const canProceed2 = category.length > 0 && budget.length > 0;

  const submit = () => {
    const ref = `REF-${Date.now().toString(36).toUpperCase()}`;
    setRefNumber(ref);
    setStep(4);
    (window as any).formResult = {
      name,
      email,
      phone,
      category,
      company,
      budget,
      requirements,
      refNumber: ref,
    };
  };

  return (
    <div
      className="fixture-static"
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        padding: "40px 16px",
      }}
    >
      <div className="card" style={{ maxWidth: 640, width: "100%" }}>
        <h1>Multi-Step Form</h1>

        <div className="step-indicator">
          {["Personal Info", "Preferences", "Review"].map((label, i) => (
            <div key={i} className="step-node">
              <div
                className={`step-circle ${step >= i + 1 ? "active" : ""} ${step > i + 1 ? "completed" : ""}`}
              >
                {step > i + 1 ? "✓" : i + 1}
              </div>
              <div className="step-label">{label}</div>
            </div>
          ))}
        </div>

        {step === 1 && (
          <div id="step-1">
            <h2>Step 1: Personal Information</h2>
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="field-name">Full Name</label>
              <input
                id="field-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
              />
            </div>
            <div className="field">
              <label htmlFor="field-email">Email Address</label>
              <input
                id="field-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="you@example.com"
              />
            </div>
            <div className="field">
              <label htmlFor="field-phone">Phone Number</label>
              <input
                id="field-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                type="tel"
                placeholder="555-0123"
              />
            </div>
            <button
              className="btn btn-primary"
              disabled={!canProceed1}
              onClick={() => setStep(2)}
              style={{ width: "100%", marginTop: 24 }}
            >
              Next
            </button>
          </div>
        )}

        {step === 2 && (
          <div id="step-2">
            <h2>Step 2: Preferences</h2>
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="field-category">Category</label>
              <select
                id="field-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{
                  width: "100%",
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}
              >
                <option value="">Select category...</option>
                <option value="Personal">Personal</option>
                <option value="Business">Business</option>
                <option value="Enterprise">Enterprise</option>
              </select>
            </div>

            {category === "Enterprise" && (
              <div className="field">
                <label htmlFor="field-company">Company Name</label>
                <input
                  id="field-company"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Your company name"
                />
              </div>
            )}

            <fieldset style={{ marginTop: 16, border: "none", padding: 0 }}>
              <legend
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#64748b",
                  marginBottom: 8,
                }}
              >
                Budget
              </legend>
              {[
                { value: "basic", label: "Basic (Free)" },
                { value: "standard", label: "Standard ($500)" },
                { value: "premium", label: "Premium ($2,000+)" },
              ].map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: 8,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="budget"
                    value={opt.value}
                    checked={budget === opt.value}
                    onChange={() => setBudget(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </fieldset>

            <div className="field">
              <label htmlFor="field-requirements">Special Requirements (optional)</label>
              <textarea
                id="field-requirements"
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                placeholder="Any special requirements..."
                rows={2}
                style={{
                  width: "100%",
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
              />
            </div>

            <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
              <button
                className="btn btn-ghost"
                onClick={() => setStep(1)}
                style={{ flex: 1 }}
              >
                Back
              </button>
              <button
                className="btn btn-primary"
                disabled={!canProceed2}
                onClick={() => setStep(3)}
                style={{ flex: 1 }}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div id="step-3">
            <h2>Step 3: Review &amp; Submit</h2>
            <div
              style={{
                marginTop: 16,
                padding: 16,
                background: "#f8fafc",
                borderRadius: 8,
              }}
            >
              <div style={{ marginBottom: 8 }}>
                <strong>Name:</strong> {name}
              </div>
              <div style={{ marginBottom: 8 }}>
                <strong>Email:</strong> {email}
              </div>
              <div style={{ marginBottom: 8 }}>
                <strong>Phone:</strong> {phone}
              </div>
              <div style={{ marginBottom: 8 }}>
                <strong>Category:</strong> {category}
              </div>
              {company && (
                <div style={{ marginBottom: 8 }}>
                  <strong>Company:</strong> {company}
                </div>
              )}
              <div style={{ marginBottom: 8 }}>
                <strong>Budget:</strong> {budget}
              </div>
              {requirements && (
                <div style={{ marginBottom: 8 }}>
                  <strong>Requirements:</strong> {requirements}
                </div>
              )}
            </div>

            <label
              htmlFor="field-confirm"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 20,
                cursor: "pointer",
              }}
            >
              <input
                id="field-confirm"
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I confirm the above information is correct
            </label>

            <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
              <button
                className="btn btn-ghost"
                onClick={() => setStep(2)}
                style={{ flex: 1 }}
              >
                Back
              </button>
              <button
                className="btn btn-primary"
                disabled={!confirmed}
                onClick={submit}
                style={{ flex: 1 }}
              >
                Submit
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div
            id="confirmation-panel"
            style={{ textAlign: "center", padding: 24 }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
            <h2>Submission Complete!</h2>
            <p style={{ color: "#64748b", marginTop: 8 }}>
              Your reference number is: <strong>{refNumber}</strong>
            </p>
            <p style={{ color: "#64748b", marginTop: 4 }}>
              We will contact you at {email}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
