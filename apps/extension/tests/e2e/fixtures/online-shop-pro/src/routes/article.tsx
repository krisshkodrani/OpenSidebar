import { useState } from "react";

export default function ArticleResearch() {
  const [showAnswer, setShowAnswer] = useState(false);

  return (
    <div className="fixture-static">
      <div className="header">
        <h1>The Complete Guide to Remote Work Best Practices</h1>
      </div>
      <div className="container">
        <article className="card">
          <p className="lede">
            This comprehensive guide explores the strategies, tools, and habits
            that make remote teams productive and engaged in today's distributed
            work environment.
          </p>

          <h2>Introduction</h2>
          <p>
            Remote work has evolved from a niche arrangement to a mainstream
            employment model. Companies worldwide have discovered that
            distributed teams can be just as productive—if not more so—than
            their co-located counterparts.
          </p>

          <h2>Key Principles</h2>
          <p>
            <strong>Asynchronous Communication:</strong> The cornerstone of
            effective remote work is asynchronous communication. By documenting
            decisions and sharing updates asynchronously, team members can work
            at their own pace without constant interruptions.
          </p>
          <p style={{ marginTop: 12 }}>
            <strong>Documentation First:</strong> Successful remote teams
            prioritize documentation. Everything from project requirements to
            decision rationale should be written down and accessible.
          </p>

          <h2>Technology Stack</h2>
          <p>
            Remote teams typically leverage a combination of communication tools
            (Slack, Microsoft Teams), project management platforms (Jira,
            Asana), and video conferencing solutions (Zoom, Google Meet).
          </p>

          <h2>Challenges and Solutions</h2>
          <p>
            <strong>Isolation:</strong> Remote workers often report feelings of
            isolation. Combat this by scheduling regular virtual social events
            and encouraging informal communication channels.
          </p>
          <p style={{ marginTop: 12 }}>
            <strong>Time Zone Management:</strong> When team members span
            multiple time zones, establish core hours where everyone is
            available for synchronous collaboration.
          </p>
        </article>

        <div className="card" style={{ marginTop: 24 }}>
          <h2>Related Research</h2>
          <p>
            Studies have shown that remote workers are often more productive
            than office workers. A{" "}
            <a href="#" style={{ color: "#3b82f6" }}>
              2023 Stanford study
            </a>{" "}
            found a 13% performance improvement in remote workers.
          </p>

          <h3 style={{ marginTop: 16 }}>Additional Resources</h3>
          <ul style={{ marginTop: 8, paddingLeft: 20 }}>
            <li>GitLab's Remote Work Handbook (2024)</li>
            <li>Buffer's State of Remote Work Report</li>
            <li>Harvard Business Review: Managing Remote Teams</li>
          </ul>

          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: "#fffbeb",
              border: "1px solid #fcd34d",
              borderRadius: 8,
            }}
          >
            <strong>Footnote 1:</strong> The Stanford study collected data from
            5,000 knowledge workers over a 2-year period.
          </div>

          <div
            style={{
              marginTop: 8,
              padding: 12,
              background: "#fffbeb",
              border: "1px solid #fcd34d",
              borderRadius: 8,
            }}
          >
            <strong>Footnote 2:</strong> Buffer's report surveys over 2,500
            remote workers annually across multiple industries.
          </div>

          <div style={{ marginTop: 16 }}>
            <button
              className="btn btn-primary"
              onClick={() => setShowAnswer(!showAnswer)}
            >
              {showAnswer ? "Hide Answer" : "Reveal Hidden Answer"}
            </button>
            {showAnswer && (
              <div
                style={{
                  marginTop: 12,
                  padding: 16,
                  background: "#dcfce7",
                  borderRadius: 8,
                }}
              >
                <strong>Answer:</strong> The key finding from Footnote 1 is that
                remote workers showed a 13% increase in output compared to
                office-based workers.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
