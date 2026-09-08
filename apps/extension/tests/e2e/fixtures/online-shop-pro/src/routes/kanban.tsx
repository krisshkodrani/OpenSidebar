import { useState, useRef, useCallback, useEffect } from "react";

interface Task {
  id: string;
  title: string;
}

interface Column {
  id: string;
  label: string;
  tasks: Task[];
}

const INITIAL_COLUMNS: Column[] = [
  {
    id: "todo",
    label: "To Do",
    tasks: [
      { id: "task-1", title: "Design Homepage" },
      { id: "task-2", title: "Write API Docs" },
      { id: "task-3", title: "Setup CI Pipeline" },
    ],
  },
  {
    id: "in-progress",
    label: "In Progress",
    tasks: [
      { id: "task-4", title: "Write Tests" },
      { id: "task-5", title: "Code Review" },
    ],
  },
  {
    id: "done",
    label: "Done",
    tasks: [{ id: "task-6", title: "Project Kickoff" }],
  },
];

export default function Kanban() {
  const [columns, setColumns] = useState<Column[]>(INITIAL_COLUMNS);
  const [moves, setMoves] = useState<
    Array<{ card: string; from: string; to: string }>
  >([]);
  const draggingRef = useRef<{ taskId: string; fromCol: string } | null>(null);
  const columnsRef = useRef<Column[]>(INITIAL_COLUMNS);
  const moveKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    (window as any).kanbanResult = {
      moves,
      columns: Object.fromEntries(
        columns.map((column) => [
          column.id,
          column.tasks.map((task) => task.title),
        ]),
      ),
    };
  }, [columns, moves]);

  const moveTask = useCallback(
    (taskId: string, fromColId: string, toColId: string) => {
      if (fromColId === toColId) return;

      const moveKey = `${taskId}:${fromColId}->${toColId}`;
      if (moveKeysRef.current.has(moveKey)) return;

      const fromCol = columnsRef.current.find((c) => c.id === fromColId);
      const toCol = columnsRef.current.find((c) => c.id === toColId);
      if (!fromCol || !toCol) return;

      const task = fromCol.tasks.find((t) => t.id === taskId);
      if (!task) return;

      moveKeysRef.current.add(moveKey);

      const nextColumns = columnsRef.current.map((col) => {
        if (col.id === fromColId) {
          return { ...col, tasks: col.tasks.filter((t) => t.id !== taskId) };
        }
        if (col.id === toColId) {
          return { ...col, tasks: [...col.tasks, task] };
        }
        return col;
      });
      columnsRef.current = nextColumns;
      setColumns(nextColumns);

      const taskTitle =
        INITIAL_COLUMNS.flatMap((c) => c.tasks).find((t) => t.id === taskId)
          ?.title || taskId;

      const newMove = { card: taskTitle, from: fromColId, to: toColId };
      setMoves((prev) => [...prev, newMove]);
    },
    [],
  );

  // Pointer-based drag handling (matches executeDragAndDrop Strategy 1)
  const handlePointerDown = (taskId: string, colId: string) => {
    draggingRef.current = { taskId, fromCol: colId };
  };

  // HTML5 DnD handlers (Strategy 2 fallback)
  const handleDragStart = (
    e: React.DragEvent,
    taskId: string,
    colId: string,
  ) => {
    draggingRef.current = { taskId, fromCol: colId };
    e.dataTransfer.setData("text/plain", taskId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, toColId: string) => {
    e.preventDefault();
    if (draggingRef.current) {
      moveTask(
        draggingRef.current.taskId,
        draggingRef.current.fromCol,
        toColId,
      );
      draggingRef.current = null;
    }
  };

  // Pointer-based drop: listen for pointerup on column drop zones
  const handlePointerUp = (toColId: string) => {
    if (draggingRef.current) {
      moveTask(
        draggingRef.current.taskId,
        draggingRef.current.fromCol,
        toColId,
      );
      draggingRef.current = null;
    }
  };

  return (
    <div className="fixture-static" style={{ minHeight: "100vh" }}>
      <div className="header">
        <h1>Kanban Board</h1>
        <p>Drag task cards between columns to update their status.</p>
      </div>

      <div
        style={{
          display: "flex",
          gap: 20,
          padding: "32px 24px",
          maxWidth: 1000,
          margin: "0 auto",
        }}
      >
        {columns.map((col) => (
          <div
            key={col.id}
            data-column={col.id}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, col.id)}
            onPointerUp={() => handlePointerUp(col.id)}
            style={{
              flex: 1,
              background: "#f1f5f9",
              borderRadius: 12,
              padding: 16,
              minHeight: 400,
            }}
          >
            <h3
              style={{
                fontSize: 14,
                fontWeight: 700,
                textTransform: "uppercase",
                color: "#64748b",
                marginBottom: 12,
                letterSpacing: "0.05em",
              }}
            >
              {col.label}{" "}
              <span
                style={{
                  background: "#e2e8f0",
                  borderRadius: 12,
                  padding: "2px 8px",
                  fontSize: 12,
                }}
              >
                {col.tasks.length}
              </span>
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {col.tasks.map((task) => (
                <div
                  key={task.id}
                  data-task-id={task.id}
                  draggable="true"
                  onDragStart={(e) => handleDragStart(e, task.id, col.id)}
                  onPointerDown={() => handlePointerDown(task.id, col.id)}
                  style={{
                    background: "#fff",
                    borderRadius: 8,
                    padding: "12px 16px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                    cursor: "grab",
                    fontSize: 14,
                    fontWeight: 500,
                    border: "1px solid #e2e8f0",
                    userSelect: "none",
                  }}
                >
                  {task.title}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Move log */}
      {moves.length > 0 && (
        <div
          id="move-log"
          style={{
            maxWidth: 600,
            margin: "0 auto 32px",
            padding: "16px 24px",
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: 8,
          }}
        >
          <h4 style={{ marginBottom: 8, color: "#166534" }}>Move History</h4>
          {moves.map((m, i) => (
            <p key={i} style={{ fontSize: 13, color: "#475569" }}>
              Moved "{m.card}" from {m.from} → {m.to}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
