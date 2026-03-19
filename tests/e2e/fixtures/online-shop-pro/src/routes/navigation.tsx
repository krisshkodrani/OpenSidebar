import { useState } from "react";

const SECRET_CODE = "ALPHA-7492";

export default function NavigationChallenge() {
  const [clickCount, setClickCount] = useState(0);
  const [code, setCode] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const showSecret = clickCount >= 3;

  const handleAdvance = () => {
    setClickCount((c) => c + 1);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (code === SECRET_CODE) {
      setSubmitted(true);
      (window as any).challengeResult = {
        completed: true,
        code: SECRET_CODE,
      };
    }
  };

  return (
    <div className="fixture-static">
      <div className="header">
        <h1>Navigation Challenge</h1>
      </div>
      <div className="container">
        <div className="card">
          <div className="instructions">
            Click the Advance button 3 times. A secret code will appear.
            Enter the code and submit it.
          </div>

          <div style={{ textAlign: "center", padding: 24 }}>
            <p style={{ marginBottom: 16 }}>
              Step counter: {clickCount}/3
            </p>

            {!showSecret && (
              <button
                className="btn btn-primary"
                onClick={handleAdvance}
                style={{ padding: "12px 32px", fontSize: 16 }}
              >
                Advance
              </button>
            )}

            {showSecret && !submitted && (
              <div>
                <p style={{ marginBottom: 16 }}>
                  The secret code is:{" "}
                  <strong style={{ fontSize: 24 }}>{SECRET_CODE}</strong>
                </p>
                <form onSubmit={handleSubmit}>
                  <input
                    type="text"
                    placeholder="Enter the secret code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    style={{
                      padding: "10px 14px",
                      fontSize: 16,
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      width: 200,
                      textAlign: "center",
                    }}
                  />
                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{ marginLeft: 8, padding: "10px 20px" }}
                  >
                    Submit Code
                  </button>
                </form>
              </div>
            )}

            {submitted && (
              <div
                id="success-banner"
                style={{
                  marginTop: 16,
                  padding: 16,
                  background: "#dcfce7",
                  borderRadius: 8,
                }}
              >
                Challenge Complete!
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
