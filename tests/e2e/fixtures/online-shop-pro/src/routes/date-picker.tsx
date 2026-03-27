import { useState } from "react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAYS_OF_WEEK = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

export default function DatePicker() {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [viewYear, setViewYear] = useState(2026);
  const [viewMonth, setViewMonth] = useState(4); // May 2026
  const [selectedDate, setSelectedDate] = useState("");
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // Target: June 15, 2026
  const TARGET_DATE = "2026-06-15";

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfWeek(viewYear, viewMonth);

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const selectDay = (day: number) => {
    const month = String(viewMonth + 1).padStart(2, "0");
    const dayStr = String(day).padStart(2, "0");
    const dateStr = `${viewYear}-${month}-${dayStr}`;
    setSelectedDate(dateStr);
    setCalendarOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !selectedDate) return;
    setSubmitted(true);
    (window as any).datePickerResult = {
      name: name.trim(),
      date: selectedDate,
      correct: selectedDate === TARGET_DATE,
    };
  };

  const formatDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    return `${MONTHS[m - 1]} ${d}, ${y}`;
  };

  return (
    <div className="fixture-static" style={{ minHeight: "100vh" }}>
      <div className="header">
        <h1>Booking Form</h1>
        <p>Select a date using the calendar picker. Target: June 15, 2026.</p>
      </div>

      <div
        className="container"
        style={{ maxWidth: 500, margin: "32px auto", padding: "0 24px" }}
      >
        <div className="card" style={{ padding: 24 }}>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label
                htmlFor="booking-name"
                style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: 14 }}
              >
                Full Name
              </label>
              <input
                id="booking-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  fontSize: 14,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}
              />
            </div>

            <div style={{ marginBottom: 16, position: "relative" }}>
              <label
                style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: 14 }}
              >
                Appointment Date
              </label>
              <button
                type="button"
                id="date-trigger"
                onClick={() => setCalendarOpen(!calendarOpen)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  fontSize: 14,
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  background: "#fff",
                  textAlign: "left",
                  cursor: "pointer",
                  color: selectedDate ? "#0f172a" : "#94a3b8",
                }}
              >
                {selectedDate ? formatDate(selectedDate) : "Click to select a date..."}
              </button>

              {/* Calendar widget */}
              {calendarOpen && (
                <div
                  id="calendar-widget"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: 12,
                    padding: 16,
                    boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
                    zIndex: 100,
                    width: 300,
                  }}
                >
                  {/* Month/Year navigation */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 12,
                    }}
                  >
                    <button
                      type="button"
                      onClick={prevMonth}
                      aria-label="Previous month"
                      style={{
                        background: "none",
                        border: "1px solid #e2e8f0",
                        borderRadius: 6,
                        padding: "4px 10px",
                        cursor: "pointer",
                        fontSize: 14,
                      }}
                    >
                      &lt;
                    </button>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>
                      {MONTHS[viewMonth]} {viewYear}
                    </span>
                    <button
                      type="button"
                      onClick={nextMonth}
                      aria-label="Next month"
                      style={{
                        background: "none",
                        border: "1px solid #e2e8f0",
                        borderRadius: 6,
                        padding: "4px 10px",
                        cursor: "pointer",
                        fontSize: 14,
                      }}
                    >
                      &gt;
                    </button>
                  </div>

                  {/* Day headers */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7, 1fr)",
                      gap: 2,
                      marginBottom: 4,
                    }}
                  >
                    {DAYS_OF_WEEK.map((d) => (
                      <div
                        key={d}
                        style={{
                          textAlign: "center",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#94a3b8",
                          padding: "4px 0",
                        }}
                      >
                        {d}
                      </div>
                    ))}
                  </div>

                  {/* Day grid */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7, 1fr)",
                      gap: 2,
                    }}
                  >
                    {/* Empty cells before first day */}
                    {Array.from({ length: firstDay }, (_, i) => (
                      <div key={`empty-${i}`} />
                    ))}

                    {/* Day buttons */}
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const day = i + 1;
                      const month = String(viewMonth + 1).padStart(2, "0");
                      const dayStr = String(day).padStart(2, "0");
                      const dateStr = `${viewYear}-${month}-${dayStr}`;
                      const isSelected = dateStr === selectedDate;

                      return (
                        <button
                          key={day}
                          type="button"
                          data-date={dateStr}
                          onClick={() => selectDay(day)}
                          style={{
                            padding: "6px 0",
                            fontSize: 13,
                            border: "none",
                            borderRadius: 6,
                            cursor: "pointer",
                            background: isSelected ? "#3b82f6" : "transparent",
                            color: isSelected ? "#fff" : "#334155",
                            fontWeight: isSelected ? 600 : 400,
                          }}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={!name.trim() || !selectedDate}
              style={{
                width: "100%",
                padding: "12px 20px",
                background: !name.trim() || !selectedDate ? "#cbd5e1" : "#3b82f6",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: !name.trim() || !selectedDate ? "default" : "pointer",
                fontSize: 15,
                fontWeight: 600,
              }}
            >
              Book Appointment
            </button>
          </form>

          {submitted && (
            <div
              id="booking-confirmation"
              style={{
                marginTop: 16,
                padding: 16,
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: 8,
                textAlign: "center",
              }}
            >
              <h3 style={{ color: "#166534", marginBottom: 4 }}>Booking Confirmed!</h3>
              <p style={{ fontSize: 14, color: "#475569" }}>
                {name} — {formatDate(selectedDate)}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
