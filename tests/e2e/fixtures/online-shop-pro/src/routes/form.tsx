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

  const canProceed1 = name && email.includes("@") && phone;
  const canProceed2 = category && budget;

  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(s - 1, 1));

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
          {[1, 2, 3].map((s) => (
            <div key={s} className="step-node">
              <div
                className={`step-circle ${step >= s ? "active" : ""} ${step > s ? "completed" : ""}`}
              >
                {step > s ? "✓" : s}
              </div>
              <div className="step-label">
                {s === 1 && "Personal"}
                {s === 2 && "Preferences"}
                {s === 3 && "Review"}
              </div>
            </div>
          ))}
        </div>

        {step === 1 && (
          <div id="step-1">
            <h2>Personal Information</h2>
            <div className="field" style={{ marginTop: 16 }}>
              <label>Full Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
              />
            </div>
            <div className="field">
              <label>Email Address</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="you@example.com"
              />
            </div>
            <div className="field">
              <label>Phone Number</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                type="tel"
                placeholder="555-0123"
              />
            </div>
            <div style={{ marginTop: 24 }}>
              <button
                className="btn btn-primary"
                disabled={!canProceed1}
                onClick={next}
                style={{ width: "100%" }}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div id="step-2">
            <h2>Preferences</h2>
            <div className="field" style={{ marginTop: 16 }}>
              <label>Category</label>
              <select
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
                <label>Company Name</label>
                <input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Your company name"
                />
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#64748b",
                  display: "block",
                  marginBottom: 8,
                }}
              >
                Budget
              </label>
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
                    checked={budget === opt.value}
                    onChange={() => setBudget(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>

            <div className="field">
              <label>Special Requirements</label>
              <textarea
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                placeholder="Any special requirements..."
                rows={3}
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
                onClick={back}
                style={{ flex: 1 }}
              >
                Back
              </button>
              <button
                className="btn btn-primary"
                disabled={!canProceed2}
                onClick={next}
                style={{ flex: 1 }}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div id="step-3">
            <h2>Review & Submit</h2>
            <div
              style={{
                marginTop: 16,
                padding: 16,
                background: "#f8fafc",
                borderRadius: 8,
              }}
            >
              <div style={{ marginBottom: 12 }}>
                <strong>Name:</strong> {name}
              </div>
              <div style={{ marginBottom: 12 }}>
                <strong>Email:</strong> {email}
              </div>
              <div style={{ marginBottom: 12 }}>
                <strong>Phone:</strong> {phone}
              </div>
              <div style={{ marginBottom: 12 }}>
                <strong>Category:</strong> {category}
              </div>
              {company && (
                <div style={{ marginBottom: 12 }}>
                  <strong>Company:</strong> {company}
                </div>
              )}
              <div style={{ marginBottom: 12 }}>
                <strong>Budget:</strong> {budget}
              </div>
              {requirements && (
                <div style={{ marginBottom: 12 }}>
                  <strong>Requirements:</strong> {requirements}
                </div>
              )}
            </div>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 20,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I confirm the above information is correct
            </label>

            <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
              <button
                className="btn btn-ghost"
                onClick={back}
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
