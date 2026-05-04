import { useState } from "react";

export default function ErrorScenarios() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [contactError, setContactError] = useState("");
  const [contactSuccess, setContactSuccess] = useState(false);

  const [delayedLoading, setDelayedLoading] = useState(false);
  const [delayedLoaded, setDelayedLoaded] = useState(false);

  const handleContactSubmit = (e) => {
    e.preventDefault();
    setContactError("");
    setContactSuccess(false);

    if (!email.includes("@")) {
      setContactError("Please enter a valid email address.");
      return;
    }
    if (message.length < 10) {
      setContactError("Message must be at least 10 characters.");
      return;
    }

    setContactSuccess(true);
    (window as any).contactResult = {
      sent: true,
      email,
      message,
    };
  };

  const handleDelayed = () => {
    setDelayedLoading(true);
    setTimeout(() => {
      setDelayedLoading(false);
      setDelayedLoaded(true);
      (window as any).delayedLoaded = true;
    }, 2000);
  };

  return (
    <div className="fixture-static">
      <div className="header">
        <h1>Error Scenarios</h1>
        <p>
          A page with intentionally tricky elements for testing agent error
          handling.
        </p>
      </div>

      <div className="cards">
        <div className="card">
          <h2>Contact Form</h2>
          <form onSubmit={handleContactSubmit}>
            <div className="field">
              <label>Email address</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
              />
            </div>
            <div className="field">
              <label>Message</label>
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Enter a message (min 10 chars)"
              />
            </div>
            <button type="submit" className="btn btn-primary">
              Send Message
            </button>
            {contactError && <p className="error">{contactError}</p>}
            {contactSuccess && (
              <p className="success">Message sent successfully!</p>
            )}
          </form>
        </div>

        <div className="card">
          <h2>Delayed Content</h2>
          <p>Click "Load Content" and wait for the result to appear.</p>
          <button className="btn btn-primary" onClick={handleDelayed}>
            Load Content
          </button>
          {delayedLoading && <p style={{ marginTop: 12 }}>Loading...</p>}
          {delayedLoaded && (
            <div style={{ marginTop: 12 }}>
              <p id="delayed-text">The answer is 42</p>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Impossible Task</h2>
          <p>
            This card does not include any report generation controls.
          </p>
          <div id="report-status" className="hidden" />
        </div>
      </div>
    </div>
  );
}
