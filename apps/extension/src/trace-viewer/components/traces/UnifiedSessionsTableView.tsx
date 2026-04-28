import React, { useMemo, useRef } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type FilterFn,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStore } from "../../store";
import type { TraceSession } from "../../../types/traces";
import Badge from "../Badge";
import Tooltip from "../Tooltip";
import {
  outcomeClass,
  formatTime,
  formatCost,
  getSessionModels,
  shortModel,
  extractQueryTitle,
  truncate,
} from "../../utils";

// ── Custom filter functions ────────────────────────────────────

const fuzzyFilter: FilterFn<TraceSession> = (row, columnId, filterValue) => {
  const value = row.getValue(columnId);
  if (value == null) return false;
  return String(value)
    .toLowerCase()
    .includes(String(filterValue).toLowerCase());
};

const skillFilter: FilterFn<TraceSession> = (row, _columnId, filterValue) => {
  if (!filterValue || filterValue === "all") return true;
  const session = row.original;
  const skillIds = new Set<string>();
  if (session.skillToolMetrics?.skillId) {
    skillIds.add(session.skillToolMetrics.skillId);
  }
  if (session.planDecomposition?.steps) {
    for (const step of session.planDecomposition.steps) {
      if (step.selectedSkillId) {
        skillIds.add(step.selectedSkillId);
      }
    }
  }
  return skillIds.has(filterValue as string);
};

// ── Column definitions ─────────────────────────────────────────

function createColumns(
  navigateToSkillProp?: (skillId: string) => void,
): ColumnDef<TraceSession>[] {
  return [
    {
      accessorKey: "startTime",
      header: "Time",
      size: 72,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-trace-muted text-[11px]">
          {formatTime(row.original.startTime)}
        </span>
      ),
    },
    {
      accessorKey: "query",
      header: "Query",
      size: 200,
      enableSorting: true,
      filterFn: fuzzyFilter,
      cell: ({ row }) => (
        <span className="text-trace-text truncate pr-2">
          {truncate(extractQueryTitle(row.original.query).title, 60)}
        </span>
      ),
    },
    {
      accessorKey: "outcome",
      header: "Outcome",
      size: 80,
      enableSorting: true,
      filterFn: fuzzyFilter,
      cell: ({ row }) => (
        <Badge
          variant={
            outcomeClass(row.original.outcome) as
              | "completed"
              | "stopped"
              | "error"
              | "max_turns"
          }
        >
          {row.original.outcome}
        </Badge>
      ),
    },
    {
      accessorKey: "turnCount",
      header: "Turns",
      size: 52,
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-trace-subtle text-right">
          {row.original.turnCount || 0}
        </span>
      ),
    },
    {
      id: "skill",
      header: "Skill",
      size: 120,
      enableSorting: false,
      filterFn: skillFilter,
      accessorFn: (row) => {
        const ids = new Set<string>();
        if (row.skillToolMetrics?.skillId) {
          ids.add(row.skillToolMetrics.skillId);
        }
        if (row.planDecomposition?.steps) {
          for (const step of row.planDecomposition.steps) {
            if (step.selectedSkillId) {
              ids.add(step.selectedSkillId);
            }
          }
        }
        return Array.from(ids);
      },
      cell: ({ row }) => {
        const skillIds = row.getValue<string[]>("skill");
        if (skillIds.length === 0) return <span>—</span>;

        return (
          <Tooltip content={`Skills: ${skillIds.join(", ")}`}>
            <span className="text-trace-accent text-[10px] truncate">
              {skillIds.map((id, i) => (
                <span key={id}>
                  {navigateToSkillProp ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigateToSkillProp(id);
                      }}
                      className="hover:underline cursor-pointer"
                    >
                      {id.replace(/-/g, " ")}
                    </button>
                  ) : (
                    id.replace(/-/g, " ")
                  )}
                  {i < skillIds.length - 1 && (
                    <span className="text-trace-muted">, </span>
                  )}
                </span>
              ))}
            </span>
          </Tooltip>
        );
      },
    },
    {
      id: "model",
      header: "Model",
      size: 100,
      enableSorting: false,
      accessorFn: (row) => getSessionModels(row),
      cell: ({ row }) => {
        const models = row.getValue<string[]>("model");
        const modelDisplay = models.length > 0 ? shortModel(models[0]) : "—";
        const hasMultipleModels = models.length > 1;

        return (
          <Tooltip
            content={
              hasMultipleModels
                ? `Models: ${models.map(shortModel).join(", ")}`
                : "Model used for this session"
            }
          >
            <span className="text-trace-subtle text-[10px] truncate cursor-help">
              {modelDisplay}
              {hasMultipleModels ? ` (+${models.length - 1})` : ""}
            </span>
          </Tooltip>
        );
      },
    },
    {
      id: "cost",
      header: "Est. Cost",
      size: 72,
      enableSorting: true,
      accessorFn: (row) => row.metrics?.totalCost ?? 0,
      cell: ({ row }) => {
        const cost = row.original.metrics?.totalCost;
        return (
          <span className="text-trace-subtle font-mono text-right">
            {cost ? formatCost(cost) : "-"}
          </span>
        );
      },
    },
    {
      id: "runId",
      header: "Run",
      size: 80,
      enableSorting: false,
      accessorFn: (row) => (row as any).runId as string | undefined,
      cell: ({ row }) => {
        const runId = row.getValue<string | undefined>("runId");
        return (
          <Tooltip
            content={
              runId
                ? `Part of run: ${runId}`
                : "Standalone session (not part of a run)"
            }
          >
            <span className="text-trace-accent-light text-[10px] font-mono truncate cursor-help">
              {runId ? runId.slice(0, 8) : "—"}
            </span>
          </Tooltip>
        );
      },
    },
  ];
}

// ── Component ──────────────────────────────────────────────────

interface UnifiedSessionsTableViewProps {
  onSelect: (sessionId: string) => void;
  navigateToSkill?: (skillId: string) => void;
}

export default function UnifiedSessionsTableView({
  onSelect,
  navigateToSkill,
}: UnifiedSessionsTableViewProps) {
  const sessions = useStore((s) => s.sessions);
  const tracesLoading = useStore((s) => s.tracesLoading);
  const tableSort = useStore((s) => s.tableSort);
  const setTableSort = useStore((s) => s.setTableSort);
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: tableSort.column, desc: tableSort.direction === "desc" },
  ]);

  const [globalFilter, setGlobalFilter] = React.useState("");

  // Sync table sort with store
  React.useEffect(() => {
    if (sorting.length > 0) {
      setTableSort(sorting[0].id, sorting[0].desc ? "desc" : "asc");
    }
  }, [sorting, setTableSort]);

  const columns = useMemo(
    () => createColumns(navigateToSkill),
    [navigateToSkill],
  );

  const table = useReactTable({
    data: sessions,
    columns,
    state: {
      sorting,
      globalFilter,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: fuzzyFilter,
    defaultColumn: {
      minSize: 60,
      maxSize: 800,
    },
    columnResizeMode: "onChange",
  });

  const { rows } = table.getRowModel();

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 15,
  });

  if (tracesLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-trace-muted text-sm">
        Loading sessions...
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-trace-dim text-sm">
        No sessions found. Adjust filters to see more results.
      </div>
    );
  }

  // Count unique runs from filtered rows
  const uniqueRuns = new Set(
    rows.map((r) => (r.original as any).runId).filter(Boolean),
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Global filter */}
      <div className="px-4 py-2 border-b border-trace-border bg-trace-bg shrink-0">
        <input
          type="text"
          placeholder="Search sessions..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="w-full max-w-md px-3 py-1.5 text-sm bg-trace-surface border border-trace-border rounded text-trace-text placeholder:text-trace-dim focus:outline-none focus:border-trace-accent"
        />
      </div>

      {/* Table header */}
      <div className="flex items-center px-4 py-2 text-[10px] font-semibold text-trace-muted uppercase tracking-wider border-b border-trace-border bg-trace-bg shrink-0">
        {table.getHeaderGroups().map((headerGroup) =>
          headerGroup.headers.map((header) => {
            const canSort = header.column.getCanSort();
            const isSorted = header.column.getIsSorted();

            return canSort ? (
              <button
                key={header.id}
                onClick={header.column.getToggleSortingHandler()}
                className={`text-left hover:text-trace-accent-light transition-colors cursor-pointer truncate px-2 first:pl-0 last:pr-0 flex-1 ${
                  isSorted ? "text-trace-accent-light" : ""
                }`}
                style={{ minWidth: header.getSize() }}
              >
                {flexRender(
                  header.column.columnDef.header,
                  header.getContext(),
                )}
                {isSorted && (
                  <span className="ml-0.5">
                    {isSorted === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </button>
            ) : (
              <span
                key={header.id}
                className="text-left truncate px-2 first:pl-0 last:pr-0 flex-1"
                style={{ minWidth: header.getSize() }}
              >
                {flexRender(
                  header.column.columnDef.header,
                  header.getContext(),
                )}
              </span>
            );
          }),
        )}
      </div>

      {/* Virtualized rows */}
      <div ref={parentRef} className="flex-1 overflow-y-auto scrollbar-thin">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <div
                key={row.id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                onClick={() => onSelect(row.original.sessionId)}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="flex items-center px-4 py-2.5 border-b border-trace-border/50 cursor-pointer transition-colors hover:bg-trace-accent/[0.06] text-[12px]"
              >
                {row.getVisibleCells().map((cell) => (
                  <div
                    key={cell.id}
                    className="shrink-0 px-2 first:pl-0 last:pr-0 overflow-hidden flex-1"
                    style={{
                      minWidth: cell.column.getSize(),
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-4 py-1.5 text-[10px] text-trace-muted border-t border-trace-border/50 shrink-0">
        {rows.length} sessions
        {uniqueRuns.size > 0 && ` · ${uniqueRuns.size} runs`}
      </div>
    </div>
  );
}
