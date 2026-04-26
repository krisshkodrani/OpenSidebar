import { useState } from "react";

export default function JobApplication() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [coverNote, setCoverNote] = useState("");
  const [cvName, setCvName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const canSubmit =
    fullName.trim() && email.includes("@") && phone.trim() && cvName.trim();

  const submit = () => {
    const result = {
      fullName,
      email,
      phone,
      coverNote,
      cvName,
      submitted: true,
    };
    (window as any).jobApplicationResult = result;
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <main className="fixture-static">
        <div className="container">
          <div className="card">
            <h1>Application received</h1>
            <p>Thanks, {fullName}. We will contact you at {email}.</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="fixture-static">
      <div className="container">
        <div className="card">
          <h1>Frontend Engineer Application</h1>
          <p className="lede">
            Remote frontend role focused on React, TypeScript, and browser
            automation.
          </p>

          <div className="field">
            <label htmlFor="application-name">Full name</label>
            <input
              id="application-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Your full name"
            />
          </div>

          <div className="field">
            <label htmlFor="application-email">Email</label>
            <input
              id="application-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="field">
            <label htmlFor="application-phone">Phone</label>
            <input
              id="application-phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+49 170 1234567"
            />
          </div>

          <div className="field">
            <label htmlFor="application-cv">CV / resume</label>
            <input
              id="application-cv"
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={(event) =>
                setCvName(event.target.files?.[0]?.name ?? "")
              }
            />
            {cvName && <p>Selected file: {cvName}</p>}
          </div>

          <div className="field">
            <label htmlFor="application-cover-note">Cover note</label>
            <textarea
              id="application-cover-note"
              rows={4}
              value={coverNote}
              onChange={(event) => setCoverNote(event.target.value)}
              placeholder="Optional note to the hiring team"
            />
          </div>

          <button
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={submit}
          >
            Submit application
          </button>
        </div>
      </div>
    </main>
  );
}
