import { useState, useRef, useEffect } from "react";

const ROWS = 5;
const COLS = 4;
const HEADERS = ["Product", "Q1 Sales", "Q2 Sales", "Q3 Sales"];

function initialData(): string[][] {
  const products = ["Widget A", "Widget B", "Gadget C", "Service D", "Bundle E"];
  const data: string[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: string[] = [products[r]];
    for (let c = 1; c < COLS; c++) {
      row.push(`${100 + r * 50 + c * 30}`);
    }
    data.push(row);
  }
  return data;
}

export default function KeyboardNav() {
  const [data, setData] = useState(initialData);
  const [focusedCell, setFocusedCell] = useState<[number, number] | null>(null);
  const [editingCell, setEditingCell] = useState<[number, number] | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [edits, setEdits] = useState<Array<{ row: number; col: number; oldVal: string; newVal: string }>>([]);
  const gridRef = useRef<HTMLTableElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingCell]);

  // Expose results for test verification
  useEffect(() => {
    (window as any).keyboardNavResult = {
      edits,
      saved,
      currentData: data,
      editCount: edits.length,
    };
  }, [edits, saved, data]);

  // Keyboard handler at grid level
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!focusedCell) return;
    const [row, col] = focusedCell;

    if (editingCell) {
      // In edit mode
      if (e.key === "Enter") {
        e.preventDefault();
        commitEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setEditingCell(null);
        setEditValue("");
      } else if (e.key === "Tab") {
        e.preventDefault();
        commitEdit();
        // Move to next cell
        const nextCol = col + 1 < COLS ? col + 1 : 0;
        const nextRow = nextCol === 0 ? Math.min(row + 1, ROWS - 1) : row;
        setFocusedCell([nextRow, nextCol]);
      }
      return;
    }

    // Navigation mode
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        if (row > 0) setFocusedCell([row - 1, col]);
        break;
      case "ArrowDown":
        e.preventDefault();
        if (row < ROWS - 1) setFocusedCell([row + 1, col]);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (col > 0) setFocusedCell([row, col - 1]);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (col < COLS - 1) setFocusedCell([row, col + 1]);
        break;
      case "Enter":
        e.preventDefault();
        startEdit(row, col);
        break;
      case "Tab":
        e.preventDefault();
        const nextCol = col + 1 < COLS ? col + 1 : 0;
        const nextRow = nextCol === 0 ? Math.min(row + 1, ROWS - 1) : row;
        setFocusedCell([nextRow, nextCol]);
        break;
    }

    // Ctrl+S to save
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      setSaved(true);
      (window as any).keyboardNavResult = {
        edits,
        saved: true,
        currentData: data,
        editCount: edits.length,
      };
    }
  };

  const startEdit = (row: number, col: number) => {
    setEditingCell([row, col]);
    setEditValue(data[row][col]);
  };

  const commitEdit = () => {
    if (!editingCell) return;
    const [row, col] = editingCell;
    const oldVal = data[row][col];
    const newVal = editValue.trim() || oldVal;

    if (newVal !== oldVal) {
      setData((prev) => {
        const next = prev.map((r) => [...r]);
        next[row][col] = newVal;
        return next;
      });
      setEdits((prev) => [...prev, { row, col, oldVal, newVal }]);
    }

    setEditingCell(null);
    setEditValue("");
  };

  return (
    <div className="fixture-static" style={{ minHeight: "100vh" }}>
      <div className="header">
        <h1>Spreadsheet Editor</h1>
        <p>
          Navigate with arrow keys, Tab to move between cells, Enter to edit,
          Escape to cancel, Ctrl+S to save.
        </p>
      </div>

      <div
        className="container"
        style={{ maxWidth: 700, margin: "32px auto", padding: "0 24px" }}
      >
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table
            ref={gridRef}
            role="grid"
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (!focusedCell) setFocusedCell([0, 0]);
            }}
            style={{
              width: "100%",
              borderCollapse: "collapse",
              outline: "none",
            }}
          >
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {HEADERS.map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "10px 16px",
                      fontSize: 13,
                      color: "#64748b",
                      fontWeight: 600,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, ri) => (
                <tr key={ri} style={{ borderTop: "1px solid #f1f5f9" }}>
                  {row.map((cell, ci) => {
                    const isFocused =
                      focusedCell?.[0] === ri && focusedCell?.[1] === ci;
                    const isEditing =
                      editingCell?.[0] === ri && editingCell?.[1] === ci;

                    return (
                      <td
                        key={ci}
                        data-row={ri}
                        data-col={ci}
                        onClick={() => {
                          setFocusedCell([ri, ci]);
                          gridRef.current?.focus();
                        }}
                        onDoubleClick={() => startEdit(ri, ci)}
                        style={{
                          padding: isEditing ? "2px" : "10px 16px",
                          fontSize: 14,
                          cursor: "pointer",
                          background: isEditing
                            ? "#eff6ff"
                            : isFocused
                              ? "#f0f9ff"
                              : "transparent",
                          outline: isFocused
                            ? "2px solid #3b82f6"
                            : "none",
                          outlineOffset: "-2px",
                          fontFamily: ci > 0 ? "monospace" : "inherit",
                        }}
                      >
                        {isEditing ? (
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            style={{
                              width: "100%",
                              padding: "8px 14px",
                              fontSize: 14,
                              border: "2px solid #3b82f6",
                              borderRadius: 4,
                              outline: "none",
                              fontFamily: ci > 0 ? "monospace" : "inherit",
                            }}
                          />
                        ) : (
                          cell
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Status bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 12,
            fontSize: 13,
            color: "#64748b",
          }}
        >
          <span>
            {focusedCell
              ? `Cell: ${HEADERS[focusedCell[1]]} row ${focusedCell[0] + 1}`
              : "Click a cell to start"}
            {editingCell ? " (editing)" : ""}
          </span>
          <span>{edits.length} edit(s)</span>
        </div>

        {/* Save confirmation */}
        {saved && (
          <div
            id="save-confirmation"
            style={{
              marginTop: 12,
              padding: "12px 20px",
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              borderRadius: 8,
              fontSize: 14,
              color: "#166534",
              fontWeight: 500,
            }}
          >
            Spreadsheet saved! ({edits.length} edit(s) applied)
          </div>
        )}
      </div>
    </div>
  );
}
