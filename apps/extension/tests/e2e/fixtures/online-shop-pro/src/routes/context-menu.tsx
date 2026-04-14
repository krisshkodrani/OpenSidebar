import { useState, useEffect, useRef } from "react";

interface Document {
  id: string;
  name: string;
  type: string;
  size: string;
  modified: string;
}

const DOCUMENTS: Document[] = [
  { id: "doc-1", name: "Q3 Report.pdf", type: "PDF", size: "2.4 MB", modified: "2026-03-15" },
  { id: "doc-2", name: "Budget 2026.xlsx", type: "Excel", size: "1.1 MB", modified: "2026-03-10" },
  { id: "doc-3", name: "Meeting Notes.docx", type: "Word", size: "340 KB", modified: "2026-03-20" },
  { id: "doc-4", name: "Logo Design.png", type: "Image", size: "5.2 MB", modified: "2026-02-28" },
  { id: "doc-5", name: "Presentation.pptx", type: "PowerPoint", size: "8.7 MB", modified: "2026-03-22" },
];

const MENU_OPTIONS = ["Rename", "Delete", "Download", "Share"];

export default function ContextMenu() {
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [menuTargetId, setMenuTargetId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [documents, setDocuments] = useState(DOCUMENTS);
  const [renamedDoc, setRenamedDoc] = useState<{ oldName: string; newName: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Close context menu on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuVisible(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  // Focus rename input when editing starts
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // Expose results for test verification
  useEffect(() => {
    (window as any).contextMenuResult = {
      renamed: !!renamedDoc,
      newName: renamedDoc?.newName || "",
      oldName: renamedDoc?.oldName || "",
    };
  });

  const handleContextMenu = (e: React.MouseEvent, docId: string) => {
    e.preventDefault();
    setMenuPosition({ x: e.clientX, y: e.clientY });
    setMenuTargetId(docId);
    setMenuVisible(true);
  };

  // Also listen for the synthetic contextmenu event from right_click tool
  const handleNativeContextMenu = (e: Event, docId: string) => {
    e.preventDefault();
    const mouseEvent = e as MouseEvent;
    setMenuPosition({
      x: mouseEvent.clientX || 200,
      y: mouseEvent.clientY || 200,
    });
    setMenuTargetId(docId);
    setMenuVisible(true);
  };

  const handleMenuClick = (action: string) => {
    if (!menuTargetId) return;
    setMenuVisible(false);

    if (action === "Rename") {
      const doc = documents.find((d) => d.id === menuTargetId);
      if (doc) {
        setRenamingId(menuTargetId);
        setRenameValue(doc.name);
      }
    }
  };

  const handleRenameSubmit = (docId: string) => {
    if (!renameValue.trim()) return;

    const oldDoc = documents.find((d) => d.id === docId);
    const oldName = oldDoc?.name || "";

    setDocuments((prev) =>
      prev.map((d) => (d.id === docId ? { ...d, name: renameValue.trim() } : d)),
    );
    setRenamedDoc({ oldName, newName: renameValue.trim() });
    setRenamingId(null);

    (window as any).contextMenuResult = {
      renamed: true,
      newName: renameValue.trim(),
      oldName,
    };
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent, docId: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRenameSubmit(docId);
    } else if (e.key === "Escape") {
      setRenamingId(null);
    }
  };

  return (
    <div className="fixture-static" style={{ minHeight: "100vh" }}>
      <div className="header">
        <h1>Document Manager</h1>
        <p>Right-click on a document to see actions (Rename, Delete, Download, Share).</p>
      </div>

      <div
        className="container"
        style={{ maxWidth: 700, margin: "32px auto", padding: "0 24px" }}
      >
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={{ textAlign: "left", padding: "10px 16px", fontSize: 13, color: "#64748b" }}>
                  Name
                </th>
                <th style={{ textAlign: "left", padding: "10px 16px", fontSize: 13, color: "#64748b" }}>
                  Type
                </th>
                <th style={{ textAlign: "left", padding: "10px 16px", fontSize: 13, color: "#64748b" }}>
                  Size
                </th>
                <th style={{ textAlign: "left", padding: "10px 16px", fontSize: 13, color: "#64748b" }}>
                  Modified
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr
                  key={doc.id}
                  data-doc-id={doc.id}
                  onContextMenu={(e) => handleContextMenu(e, doc.id)}
                  ref={(el) => {
                    if (el) {
                      // Attach native contextmenu listener for synthetic events
                      el.oncontextmenu = (ev) => handleNativeContextMenu(ev, doc.id);
                    }
                  }}
                  style={{
                    borderTop: "1px solid #f1f5f9",
                    cursor: "context-menu",
                    background: renamingId === doc.id ? "#eff6ff" : "transparent",
                  }}
                >
                  <td style={{ padding: "12px 16px", fontSize: 14 }}>
                    {renamingId === doc.id ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => handleRenameKeyDown(e, doc.id)}
                        onBlur={() => handleRenameSubmit(doc.id)}
                        style={{
                          padding: "4px 8px",
                          fontSize: 14,
                          border: "2px solid #3b82f6",
                          borderRadius: 4,
                          width: "100%",
                          outline: "none",
                        }}
                      />
                    ) : (
                      <span style={{ fontWeight: 500 }}>{doc.name}</span>
                    )}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 14, color: "#64748b" }}>{doc.type}</td>
                  <td style={{ padding: "12px 16px", fontSize: 14, color: "#64748b" }}>{doc.size}</td>
                  <td style={{ padding: "12px 16px", fontSize: 14, color: "#64748b" }}>{doc.modified}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Rename confirmation */}
        {renamedDoc && (
          <div
            id="rename-confirmation"
            style={{
              marginTop: 16,
              padding: "12px 20px",
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              borderRadius: 8,
              fontSize: 14,
              color: "#166534",
            }}
          >
            Renamed "{renamedDoc.oldName}" to "{renamedDoc.newName}"
          </div>
        )}
      </div>

      {/* Custom context menu */}
      {menuVisible && (
        <div
          ref={menuRef}
          id="custom-context-menu"
          style={{
            position: "fixed",
            left: menuPosition.x,
            top: menuPosition.y,
            background: "#fff",
            borderRadius: 8,
            boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
            padding: "6px 0",
            minWidth: 160,
            zIndex: 10000,
            border: "1px solid #e2e8f0",
          }}
        >
          {MENU_OPTIONS.map((option) => (
            <button
              key={option}
              onClick={() => handleMenuClick(option)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                padding: "8px 16px",
                cursor: "pointer",
                fontSize: 14,
                color: option === "Delete" ? "#dc2626" : "#334155",
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
