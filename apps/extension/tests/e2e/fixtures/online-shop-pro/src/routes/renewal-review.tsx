import { useEffect, useMemo, useState } from "react";

type RenewalView = "invoice" | "contract" | "usage" | "policy" | "draft";

const seatPrice = 240;
const invoicedSeats = 120;
const activeSeats = 73;
const discountRate = 0.15;
const invoicedTotal = invoicedSeats * seatPrice;
const correctedTotal = activeSeats * seatPrice * (1 - discountRate);
const potentialSavings = invoicedTotal - correctedTotal;

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function readView(): RenewalView {
  const value = new URLSearchParams(window.location.search).get("tab");
  return value === "contract" ||
    value === "usage" ||
    value === "policy" ||
    value === "draft"
    ? value
    : "invoice";
}

function readVisitedViews(): RenewalView[] {
  try {
    const parsed = JSON.parse(
      sessionStorage.getItem("renewal-review-visited-tabs") ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((value): value is RenewalView =>
          ["invoice", "contract", "usage", "policy", "draft"].includes(
            String(value),
          ),
        )
      : [];
  } catch {
    return [];
  }
}

export default function RenewalReview() {
  const [view, setView] = useState<RenewalView>(readView);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  const draftReady = useMemo(() => {
    const normalized = `${subject} ${message}`.toLowerCase();
    return (
      subject.trim().length >= 12 &&
      message.trim().length >= 80 &&
      normalized.includes("atlas cloud") &&
      normalized.includes("73") &&
      normalized.includes("15%") &&
      normalized.includes("$14,892") &&
      normalized.includes("$13,908")
    );
  }, [message, subject]);

  const openView = (nextView: RenewalView) => {
    const nextUrl =
      nextView === "invoice" ? "/renewal-review" : `/renewal-review?tab=${nextView}`;
    window.history.replaceState({}, "", nextUrl);
    setView(nextView);
  };

  useEffect(() => {
    const visitedViews = Array.from(new Set([...readVisitedViews(), view]));
    sessionStorage.setItem(
      "renewal-review-visited-tabs",
      JSON.stringify(visitedViews),
    );
    (window as any).renewalReviewState = {
      activeView: view,
      visitedViews,
      draft: { subject, message, ready: draftReady },
      sent,
      evidence: {
        vendor: "Atlas Cloud",
        invoice: "AC-2026-1187",
        invoicedSeats,
        activeSeats,
        seatPrice,
        discountRate,
        invoicedTotal,
        correctedTotal,
        potentialSavings,
      },
    };
  }, [draftReady, message, sent, subject, view]);

  return (
    <main className="fixture-static renewal-app">
      <div className="renewal-shell">
        <header className="renewal-header">
          <div>
            <p className="renewal-eyebrow">FINANCE OPERATIONS / RENEWAL DESK</p>
            <h1>Atlas Cloud renewal review</h1>
            <p>
              Reconcile commercial terms, licensed usage, and policy before any
              vendor communication.
            </p>
          </div>
          <div className="renewal-deadline">
            <span>RESPONSE DUE</span>
            <strong>31 JUL</strong>
            <small>4 days remaining</small>
          </div>
        </header>

        <nav className="renewal-tabs" aria-label="Renewal evidence">
          {[
            ["invoice", "Invoice"],
            ["contract", "Contract"],
            ["usage", "Usage"],
            ["policy", "Policy"],
            ["draft", "Draft"],
          ].map(([tab, label]) => (
            <button
              className={view === tab ? "active" : ""}
              key={tab}
              onClick={() => openView(tab as RenewalView)}
              type="button"
            >
              <span>{label}</span>
              {readVisitedViews().includes(tab as RenewalView) && <b>Viewed</b>}
            </button>
          ))}
        </nav>

        <div className="renewal-workspace">
          <section className="renewal-evidence-panel">
            {view === "invoice" && (
              <article aria-labelledby="renewal-invoice-title">
                <div className="renewal-section-heading">
                  <div>
                    <p>ATLAS CLOUD</p>
                    <h2 id="renewal-invoice-title">Renewal invoice</h2>
                  </div>
                  <span className="renewal-status warning">Review required</span>
                </div>
                <dl className="renewal-meta-grid">
                  <div><dt>Invoice</dt><dd>AC-2026-1187</dd></div>
                  <div><dt>Term</dt><dd>Aug 2026 - Jul 2027</dd></div>
                  <div><dt>Payment</dt><dd>Net 30</dd></div>
                </dl>
                <div className="renewal-line-item">
                  <div>
                    <span>Atlas Cloud Enterprise</span>
                    <small>Annual subscription renewal</small>
                  </div>
                  <strong>{invoicedSeats} seats</strong>
                  <strong>{money.format(seatPrice)} / seat</strong>
                  <strong>{money.format(invoicedTotal)}</strong>
                </div>
                <div className="renewal-total">
                  <span>AMOUNT DUE</span>
                  <strong>{money.format(invoicedTotal)}</strong>
                </div>
                <p className="renewal-source-note">
                  No renewal discount is shown on this invoice.
                </p>
              </article>
            )}

            {view === "contract" && (
              <article aria-labelledby="renewal-contract-title">
                <div className="renewal-section-heading">
                  <div>
                    <p>MASTER SERVICE AGREEMENT / SCHEDULE B</p>
                    <h2 id="renewal-contract-title">Commercial terms</h2>
                  </div>
                  <span className="renewal-status">Signed 12 Aug 2024</span>
                </div>
                <div className="renewal-document">
                  <span>3.2 RENEWAL PRICING</span>
                  <p>
                    Annual renewal price remains <strong>$240 per licensed seat</strong>.
                    Customer receives a <mark>15% renewal discount</mark> when the
                    agreement renews for a twelve-month term.
                  </p>
                  <span>3.4 LICENSE TRUE-DOWN</span>
                  <p>
                    Customer may reduce the renewal quantity to currently active
                    users when written notice is received before 31 July.
                  </p>
                </div>
                <aside className="renewal-callout">
                  Contract evidence: the discount and true-down right both apply.
                </aside>
              </article>
            )}

            {view === "usage" && (
              <article aria-labelledby="renewal-usage-title">
                <div className="renewal-section-heading">
                  <div>
                    <p>IDENTITY AND ACCESS / 90-DAY SNAPSHOT</p>
                    <h2 id="renewal-usage-title">License utilization</h2>
                  </div>
                  <span className="renewal-status">Synced 27 Jul, 09:10</span>
                </div>
                <div className="renewal-metric-row">
                  <div><span>Licensed</span><strong>120</strong></div>
                  <div className="accent"><span>Active users</span><strong>73</strong></div>
                  <div><span>Unassigned or inactive</span><strong>47</strong></div>
                  <div><span>Utilization</span><strong>61%</strong></div>
                </div>
                <div className="renewal-usage-bar" aria-label="73 of 120 seats active">
                  <span style={{ width: `${(activeSeats / invoicedSeats) * 100}%` }} />
                </div>
                <div className="renewal-audit-row">
                  <span>Included in active count</span>
                  <strong>Signed in during the last 90 days</strong>
                </div>
                <div className="renewal-audit-row">
                  <span>Excluded</span>
                  <strong>Disabled, unassigned, and dormant accounts</strong>
                </div>
              </article>
            )}

            {view === "policy" && (
              <article aria-labelledby="renewal-policy-title">
                <div className="renewal-section-heading">
                  <div>
                    <p>PROCUREMENT POLICY / FIN-08</p>
                    <h2 id="renewal-policy-title">Renewal controls</h2>
                  </div>
                  <span className="renewal-status">Effective Jan 2026</span>
                </div>
                <ol className="renewal-policy-list">
                  <li>
                    <b>01</b>
                    <div><strong>Reconcile first</strong><span>Compare invoices with signed pricing and current usage.</span></div>
                  </li>
                  <li>
                    <b>02</b>
                    <div><strong>Challenge material differences</strong><span>Document discrepancies above 5% with source evidence.</span></div>
                  </li>
                  <li>
                    <b>03</b>
                    <div><strong>Keep the human gate</strong><span>Vendor disputes require Finance approval before sending.</span></div>
                  </li>
                </ol>
                <aside className="renewal-callout safe">
                  Prepare the communication now. Sending remains an approval action.
                </aside>
              </article>
            )}

            {view === "draft" && (
              <article aria-labelledby="renewal-draft-title">
                <div className="renewal-section-heading">
                  <div>
                    <p>VENDOR COMMUNICATION</p>
                    <h2 id="renewal-draft-title">Dispute draft</h2>
                  </div>
                  <span className={`renewal-status ${draftReady ? "ready" : ""}`}>
                    {sent ? "Sent" : draftReady ? "Ready for approval" : "Draft"}
                  </span>
                </div>
                <div className="renewal-recipient">
                  <span>To</span>
                  <strong>renewals@atlascloud.example</strong>
                </div>
                <label className="renewal-field">
                  <span>Subject</span>
                  <input
                    data-testid="renewal-subject"
                    onChange={(event) => setSubject(event.target.value)}
                    placeholder="Renewal invoice review"
                    value={subject}
                  />
                </label>
                <label className="renewal-field">
                  <span>Message</span>
                  <textarea
                    data-testid="renewal-message"
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Summarize the discrepancy and requested correction..."
                    rows={9}
                    value={message}
                  />
                </label>
                <div className="renewal-draft-actions">
                  <span>
                    {draftReady
                      ? "Evidence complete. Finance approval is the final gate."
                      : "Include active seats, discount, corrected total, and savings."}
                  </span>
                  <button
                    className="renewal-send"
                    disabled={!draftReady || sent}
                    onClick={() => setSent(true)}
                    type="button"
                  >
                    {sent ? "Dispute sent" : "Send dispute - requires approval"}
                  </button>
                </div>
              </article>
            )}
          </section>

          <aside className="renewal-decision-panel" aria-label="Decision brief">
            <p>LIVE DECISION BRIEF</p>
            <h2>{draftReady ? "Renewal reviewed" : "Evidence in progress"}</h2>
            <dl>
              <div><dt>Invoice</dt><dd>{money.format(invoicedTotal)}</dd></div>
              <div><dt>Corrected renewal</dt><dd>{money.format(correctedTotal)}</dd></div>
              <div className="savings"><dt>Potential savings</dt><dd>{money.format(potentialSavings)}</dd></div>
            </dl>
            <div className="renewal-findings">
              <strong>2 discrepancies</strong>
              <span>47 excess seats</span>
              <span>15% discount missing</span>
            </div>
            <div className={`renewal-gate ${draftReady ? "ready" : ""}`}>
              <span>{draftReady ? "WAITING FOR YOU" : "NEXT STEP"}</span>
              <strong>{draftReady ? "Approve and send" : "Complete evidence review"}</strong>
              <small>Risky actions wait for you.</small>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
