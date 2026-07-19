import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * React-select-style custom combobox — the widget shape that made the agent
 * loop on real Greenhouse forms. Faithful to the three properties that broke
 * every feedback channel:
 *   1. the option menu is PORTALED to document.body (not a structural child);
 *   2. on commit the inner <input> is CLEARED — the chosen value renders in a
 *      sibling `.select__single-value` node instead;
 *   3. the page prints no "Selected: X" confirmation text.
 * Two widgets side by side also exercise value disambiguation.
 */

const COUNTRIES = [
  "Australia",
  "Austria",
  "Belgium",
  "Germany",
  "Netherlands",
];

const SALARY_BANDS = [
  "€ 40,000 - 50,000",
  "€ 50,000 - 60,000",
  "€ 60,000 - 70,000",
  "€ 70,000 - 80,000",
];

interface ComboProps {
  idPrefix: string;
  label: string;
  options: string[];
  value: string;
  onCommit(next: string): void;
}

function Combobox({ idPrefix, label, options, value, onCommit }: ComboProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const controlRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 260 });

  const visible = query
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  const openMenu = () => {
    const rect = controlRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
    setOpen(true);
  };

  const commit = (next: string) => {
    onCommit(next);
    setQuery(""); // the input CLEARS on commit — the react-select behavior
    setOpen(false);
  };

  return (
    <div style={{ marginBottom: 24, maxWidth: 320 }}>
      <label
        htmlFor={`${idPrefix}-input`}
        style={{ display: "block", fontWeight: 600, marginBottom: 6 }}
      >
        {label}
      </label>
      <div
        ref={controlRef}
        className="select__control"
        style={{
          display: "flex",
          alignItems: "center",
          border: "1px solid #b6b6c3",
          borderRadius: 6,
          padding: "6px 10px",
          background: "#fff",
        }}
      >
        <div
          className="select__value-container"
          style={{ display: "flex", alignItems: "center", flex: 1, gap: 6 }}
        >
          {value && !query ? (
            <div className="select__single-value">{value}</div>
          ) : null}
          <input
            id={`${idPrefix}-input`}
            className="select__input"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={`${idPrefix}-listbox`}
            value={query}
            placeholder={value ? "" : "Select..."}
            style={{ border: "none", outline: "none", flex: 1, minWidth: 40 }}
            onMouseDown={openMenu}
            onFocus={openMenu}
            onChange={(e) => {
              setQuery(e.target.value);
              openMenu();
            }}
          />
        </div>
        <span aria-hidden="true" style={{ color: "#888" }}>
          ▾
        </span>
      </div>
      {open
        ? createPortal(
            <div
              id={`${idPrefix}-listbox`}
              role="listbox"
              style={{
                position: "absolute",
                top: menuPos.top,
                left: menuPos.left,
                width: menuPos.width,
                background: "#fff",
                border: "1px solid #b6b6c3",
                borderRadius: 6,
                boxShadow: "0 8px 20px rgba(0,0,0,0.12)",
                zIndex: 1000,
              }}
            >
              {visible.length === 0 ? (
                <div style={{ padding: "8px 12px", color: "#888" }}>
                  No options
                </div>
              ) : (
                visible.map((option) => (
                  <div
                    key={option}
                    role="option"
                    aria-selected={option === value}
                    className="select__option"
                    style={{ padding: "8px 12px", cursor: "pointer" }}
                    onClick={() => commit(option)}
                  >
                    {option}
                  </div>
                ))
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export default function CustomCombobox() {
  const [country, setCountry] = useState("");
  const [salary, setSalary] = useState("");

  // Test assertion hook — deliberately NOT rendered as page text, so the agent
  // can only learn the committed state from the widgets themselves.
  useEffect(() => {
    (window as any).customComboboxResult = { country, salary };
  });

  return (
    <main style={{ padding: 32, fontFamily: "system-ui, sans-serif" }}>
      <h1>Profile preferences</h1>
      <p>Pick your country and expected salary band.</p>
      <Combobox
        idPrefix="country"
        label="Which country are you currently based in?"
        options={COUNTRIES}
        value={country}
        onCommit={setCountry}
      />
      <Combobox
        idPrefix="salary"
        label="What are your salary expectations?"
        options={SALARY_BANDS}
        value={salary}
        onCommit={setSalary}
      />
    </main>
  );
}
