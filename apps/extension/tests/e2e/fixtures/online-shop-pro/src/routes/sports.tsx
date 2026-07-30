import { useEffect, useState } from "react";

type SportsView = "alert" | "official" | "booking" | "options" | "review";
type TravelOptionId = "early-train" | "later-train" | "charter";

const travelOptions = [
  {
    id: "early-train" as const,
    label: "Early train",
    depart: "06:10",
    arrive: "10:42",
    buffer: "1h 48m",
    feeEach: 12,
    compliant: true,
  },
  {
    id: "later-train" as const,
    label: "Later train",
    depart: "07:20",
    arrive: "12:05",
    buffer: "25m",
    feeEach: 32,
    compliant: false,
  },
  {
    id: "charter" as const,
    label: "Charter coach",
    depart: "05:30",
    arrive: "11:35",
    buffer: "55m",
    feeEach: 45,
    compliant: false,
  },
];

const travelers = 18;

function readView(): SportsView {
  const value = new URLSearchParams(window.location.search).get("tab");
  return value === "official" ||
    value === "booking" ||
    value === "options" ||
    value === "review"
    ? value
    : "alert";
}

function readVisitedViews(): SportsView[] {
  try {
    const parsed = JSON.parse(
      sessionStorage.getItem("sports-disruption-visited-tabs") ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((value): value is SportsView =>
          ["alert", "official", "booking", "options", "review"].includes(
            String(value),
          ),
        )
      : [];
  } catch {
    return [];
  }
}

export default function Sports() {
  const [view, setView] = useState<SportsView>(readView);
  const [selectedOption, setSelectedOption] =
    useState<TravelOptionId | null>(null);
  const [preparedOption, setPreparedOption] =
    useState<TravelOptionId | null>(null);
  const [purchaseConfirmed, setPurchaseConfirmed] = useState(false);

  const selected = travelOptions.find((option) => option.id === selectedOption);
  const prepared = travelOptions.find((option) => option.id === preparedOption);
  const preparedTotal = prepared ? prepared.feeEach * travelers : null;

  const openView = (nextView: SportsView) => {
    const nextUrl =
      nextView === "alert" ? "/sports" : `/sports?tab=${nextView}`;
    window.history.replaceState({}, "", nextUrl);
    setView(nextView);
  };

  const prepareChange = () => {
    if (!selectedOption) return;
    setPreparedOption(selectedOption);
    openView("review");
  };

  useEffect(() => {
    const visitedViews = Array.from(new Set([...readVisitedViews(), view]));
    sessionStorage.setItem(
      "sports-disruption-visited-tabs",
      JSON.stringify(visitedViews),
    );
    (window as any).sportsFixtureState = {
      activeView: view,
      visitedViews,
      selectedOption,
      preparedOption,
      purchaseConfirmed,
      event: {
        club: "Northstar FC",
        opponent: "Kingsbridge United",
        originalKickoff: "15:00",
        revisedKickoff: "12:30",
        venue: "Beacon Park",
      },
      currentBooking: {
        travelers,
        arrive: "13:10",
        conflict: true,
      },
      recommendation: prepared
        ? {
            label: prepared.label,
            depart: prepared.depart,
            arrive: prepared.arrive,
            buffer: prepared.buffer,
            changeFee: preparedTotal,
            compliant: prepared.compliant,
          }
        : null,
    };
  }, [
    prepared,
    preparedOption,
    preparedTotal,
    purchaseConfirmed,
    selectedOption,
    view,
  ]);

  return (
    <main className="fixture-static disruption-app">
      <div className="disruption-shell">
        <header className="disruption-header">
          <div>
            <p className="disruption-eyebrow">OPENSPORTS / TEAM OPERATIONS</p>
            <h1>Match-day disruption desk</h1>
            <p>
              Verify the schedule change, test the current itinerary, and prepare
              a safe replacement for the traveling squad.
            </p>
          </div>
          <div className="disruption-alert">
            <span>SCHEDULE ALERT</span>
            <strong>Kickoff moved</strong>
            <small>Saturday at Beacon Park</small>
          </div>
        </header>

        <nav className="disruption-tabs" aria-label="Disruption evidence">
          {[
            ["alert", "Alert"],
            ["official", "Official"],
            ["booking", "Booking"],
            ["options", "Options"],
            ["review", "Review"],
          ].map(([tab, label]) => (
            <button
              className={view === tab ? "active" : ""}
              key={tab}
              onClick={() => openView(tab as SportsView)}
              type="button"
            >
              <span>{label}</span>
              {readVisitedViews().includes(tab as SportsView) && <b>Viewed</b>}
            </button>
          ))}
        </nav>

        <div className="disruption-workspace">
          <section className="disruption-evidence-panel">
            {view === "alert" && (
              <article aria-labelledby="sports-alert-title">
                <div className="disruption-section-heading">
                  <div>
                    <p>COMPETITION OPERATIONS</p>
                    <h2 id="sports-alert-title">Schedule change detected</h2>
                  </div>
                  <span className="disruption-status warning">Needs verification</span>
                </div>
                <div className="disruption-match-card">
                  <div>
                    <span>PREMIER LEAGUE / MATCHDAY 31</span>
                    <strong>Northstar FC</strong>
                    <small>vs Kingsbridge United</small>
                  </div>
                  <div className="disruption-time-change">
                    <span>Previously</span>
                    <s>15:00</s>
                    <b>New alert</b>
                    <strong>12:30</strong>
                  </div>
                </div>
                <p className="disruption-source-note">
                  Alert received from a syndicated feed. Confirm against the
                  official fixture before changing travel.
                </p>
              </article>
            )}

            {view === "official" && (
              <article aria-labelledby="sports-official-title">
                <div className="disruption-section-heading">
                  <div>
                    <p>LEAGUE MATCH CENTRE / OFFICIAL</p>
                    <h2 id="sports-official-title">Confirmed fixture</h2>
                  </div>
                  <span className="disruption-status ready">Verified</span>
                </div>
                <div className="disruption-official">
                  <span>SATURDAY / 1 AUGUST 2026</span>
                  <h3>Northstar FC <b>vs</b> Kingsbridge United</h3>
                  <strong>12:30 kickoff</strong>
                  <p>Beacon Park / Gates open 10:30</p>
                </div>
                <aside className="disruption-rule">
                  Team operations requirement: traveling parties must arrive at
                  least <strong>90 minutes before kickoff</strong>.
                </aside>
              </article>
            )}

            {view === "booking" && (
              <article aria-labelledby="sports-booking-title">
                <div className="disruption-section-heading">
                  <div>
                    <p>TRAVEL BOOKING / BK-44190</p>
                    <h2 id="sports-booking-title">Current itinerary</h2>
                  </div>
                  <span className="disruption-status warning">Conflict</span>
                </div>
                <div className="disruption-journey">
                  <div><span>DEPART</span><strong>08:45</strong><small>Northstar Central</small></div>
                  <i aria-hidden="true">to</i>
                  <div><span>ARRIVE</span><strong>13:10</strong><small>Beacon Station</small></div>
                </div>
                <dl className="disruption-booking-meta">
                  <div><dt>Travelers</dt><dd>18</dd></div>
                  <div><dt>Kickoff</dt><dd>12:30</dd></div>
                  <div className="conflict"><dt>Arrival delta</dt><dd>40 min late</dd></div>
                </dl>
                <p className="disruption-source-note">
                  The current booking arrives after kickoff and cannot be used.
                </p>
              </article>
            )}

            {view === "options" && (
              <article aria-labelledby="sports-options-title">
                <div className="disruption-section-heading">
                  <div>
                    <p>LIVE ALTERNATIVES / 18 TRAVELERS</p>
                    <h2 id="sports-options-title">Replacement options</h2>
                  </div>
                  <span className="disruption-status">90-minute rule applied</span>
                </div>
                <fieldset className="disruption-options">
                  <legend>Select an itinerary to prepare</legend>
                  {travelOptions.map((option) => (
                    <label
                      className={`${selectedOption === option.id ? "selected" : ""} ${option.compliant ? "compliant" : ""}`}
                      key={option.id}
                    >
                      <input
                        checked={selectedOption === option.id}
                        name="travel-option"
                        onChange={() => setSelectedOption(option.id)}
                        type="radio"
                        value={option.id}
                      />
                      <span>
                        <strong>{option.label}</strong>
                        <small>{option.depart} - {option.arrive}</small>
                      </span>
                      <span>
                        <strong>{option.buffer}</strong>
                        <small>arrival buffer</small>
                      </span>
                      <span>
                        <strong>EUR {option.feeEach * travelers}</strong>
                        <small>total change fee</small>
                      </span>
                      <b>{option.compliant ? "Compliant" : "Too late"}</b>
                    </label>
                  ))}
                </fieldset>
                <div className="disruption-option-action">
                  <span>
                    {selected
                      ? `${selected.label}: ${selected.buffer} buffer / EUR ${selected.feeEach * travelers}`
                      : "Choose the safest policy-compliant option."}
                  </span>
                  <button
                    disabled={!selectedOption}
                    onClick={prepareChange}
                    type="button"
                  >
                    Prepare selected change
                  </button>
                </div>
              </article>
            )}

            {view === "review" && (
              <article aria-labelledby="sports-review-title">
                <div className="disruption-section-heading">
                  <div>
                    <p>CHANGE REVIEW / BK-44190</p>
                    <h2 id="sports-review-title">Itinerary change prepared</h2>
                  </div>
                  <span className={`disruption-status ${prepared ? "ready" : ""}`}>
                    {purchaseConfirmed ? "Purchased" : prepared ? "Ready for approval" : "No option selected"}
                  </span>
                </div>
                {prepared ? (
                  <>
                    <div className="disruption-review-card">
                      <div><span>REPLACEMENT</span><strong>{prepared.label}</strong></div>
                      <div><span>DEPART</span><strong>{prepared.depart}</strong></div>
                      <div><span>ARRIVE</span><strong>{prepared.arrive}</strong></div>
                      <div><span>BUFFER</span><strong>{prepared.buffer}</strong></div>
                    </div>
                    <div className="disruption-review-total">
                      <div><span>18 travelers</span><strong>EUR {preparedTotal}</strong></div>
                      <small>No charge has been made.</small>
                    </div>
                    <div className="disruption-review-actions">
                      <span>
                        The itinerary is prepared. Purchase is a consequential action.
                      </span>
                      <button
                        className="disruption-confirm"
                        disabled={purchaseConfirmed}
                        onClick={() => setPurchaseConfirmed(true)}
                        type="button"
                      >
                        {purchaseConfirmed
                          ? "Ticket change confirmed"
                          : `Confirm ticket change - EUR ${preparedTotal}`}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="disruption-empty">
                    Compare the options and prepare a compliant change first.
                  </p>
                )}
              </article>
            )}
          </section>

          <aside className="disruption-decision-panel" aria-label="Operations brief">
            <p>LIVE OPERATIONS BRIEF</p>
            <h2>{prepared ? "Safe change prepared" : "Conflict under review"}</h2>
            <dl>
              <div><dt>Kickoff</dt><dd>12:30</dd></div>
              <div><dt>Required arrival</dt><dd>By 11:00</dd></div>
              <div><dt>Current arrival</dt><dd>13:10</dd></div>
            </dl>
            <div className="disruption-findings">
              <strong>{prepared ? prepared.label : "Schedule changed"}</strong>
              <span>{prepared ? `${prepared.arrive} arrival / ${prepared.buffer} buffer` : "Current train arrives after kickoff"}</span>
              <span>{prepared ? `EUR ${preparedTotal} for all 18 travelers` : "A replacement must satisfy the 90-minute rule"}</span>
            </div>
            <div className={`disruption-gate ${prepared ? "ready" : ""}`}>
              <span>{prepared ? "WAITING FOR YOU" : "NEXT STEP"}</span>
              <strong>{prepared ? "Approve EUR 216 change" : "Compare replacement options"}</strong>
              <small>Risky actions wait for you. Nothing is purchased yet.</small>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
