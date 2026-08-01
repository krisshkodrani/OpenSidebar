import React, { useMemo } from "react";
import type { TrendPoint } from "../../hooks/useTrendData";
import { formatCost, formatPercent } from "../../utils";

const VIEW_W = 760;
const VIEW_H = 220;
const M_LEFT = 38;
const M_RIGHT = 54;
const M_TOP = 16;
const M_BOTTOM = 30;
const PLOT_W = VIEW_W - M_LEFT - M_RIGHT;
const PLOT_H = VIEW_H - M_TOP - M_BOTTOM;

function shortDay(day: string): string {
  // "YYYY-MM-DD" → "MM-DD"
  const parts = day.split("-");
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : day;
}

/**
 * Dual-series trend: success rate (line, left 0–100% axis) and estimated cost
 * (bars, right axis) over the active day window. Self-contained SVG — no chart
 * dependency — themed via the viewer's CSS variables so it tracks light/dark.
 */
export default function TrendChart({ points }: { points: TrendPoint[] }) {
  const maxCost = useMemo(
    () => Math.max(0, ...points.map((p) => p.recordedCost)),
    [points],
  );

  if (points.length === 0) {
    return (
      <div className="rounded border border-trace-border bg-trace-bg px-3 py-8 text-center text-sm text-trace-muted">
        No daily data in the current window.
      </div>
    );
  }

  const n = points.length;
  // Evenly spaced column centers; bars sit inside each column.
  const colW = PLOT_W / n;
  const barW = Math.min(28, colW * 0.55);
  const xCenter = (i: number) => M_LEFT + colW * (i + 0.5);
  const yRate = (rate: number) => M_TOP + (1 - rate) * PLOT_H;
  const yCostTop = (cost: number) =>
    maxCost <= 0 ? M_TOP + PLOT_H : M_TOP + (1 - cost / maxCost) * PLOT_H;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xCenter(i)} ${yRate(p.successRate)}`)
    .join(" ");

  // Label every Nth day so the axis never crowds.
  const labelStep = Math.ceil(n / 12);

  return (
    <div className="rounded border border-trace-border bg-trace-bg p-3">
      <div className="mb-2 flex items-center gap-4 text-[11px] text-trace-muted">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-[2px] w-4"
            style={{ background: "rgb(var(--state-success))" }}
          />
          Success rate
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: "rgb(var(--trace-accent))", opacity: 0.55 }}
          />
          Est. cost / day
        </span>
        <span className="ml-auto">{n} days</span>
      </div>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full"
        style={{ height: "auto" }}
        role="img"
        aria-label="Success rate and estimated cost per day"
      >
        {/* horizontal gridlines + left (%) axis labels at 0/50/100 */}
        {[0, 0.5, 1].map((frac) => {
          const y = M_TOP + (1 - frac) * PLOT_H;
          return (
            <g key={frac}>
              <line
                x1={M_LEFT}
                y1={y}
                x2={M_LEFT + PLOT_W}
                y2={y}
                stroke="rgb(var(--trace-border))"
                strokeWidth={1}
              />
              <text
                x={M_LEFT - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={9}
                fill="rgb(var(--trace-muted))"
              >
                {formatPercent(frac)}
              </text>
            </g>
          );
        })}

        {/* right (cost) axis labels: 0 and max */}
        <text
          x={M_LEFT + PLOT_W + 6}
          y={M_TOP + PLOT_H + 3}
          textAnchor="start"
          fontSize={9}
          fill="rgb(var(--trace-muted))"
        >
          $0
        </text>
        <text
          x={M_LEFT + PLOT_W + 6}
          y={M_TOP + 3}
          textAnchor="start"
          fontSize={9}
          fill="rgb(var(--trace-muted))"
        >
          {formatCost(maxCost) || "$0"}
        </text>

        {/* cost bars */}
        {points.map((p, i) => {
          const top = yCostTop(p.recordedCost);
          const h = M_TOP + PLOT_H - top;
          return (
            <rect
              key={`bar-${p.day}`}
              x={xCenter(i) - barW / 2}
              y={top}
              width={barW}
              height={Math.max(0, h)}
              rx={2}
              fill="rgb(var(--trace-accent))"
              opacity={0.5}
            >
              <title>
                {p.day}: {formatCost(p.recordedCost) || "$0"} •{" "}
                {p.totalSessions} traces
              </title>
            </rect>
          );
        })}

        {/* success-rate line */}
        <path
          d={linePath}
          fill="none"
          stroke="rgb(var(--state-success))"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* success-rate points */}
        {points.map((p, i) => (
          <circle
            key={`pt-${p.day}`}
            cx={xCenter(i)}
            cy={yRate(p.successRate)}
            r={2.5}
            fill="rgb(var(--state-success))"
          >
            <title>
              {p.day}: {formatPercent(p.successRate)} success (
              {p.completedSessions}/{p.totalSessions})
            </title>
          </circle>
        ))}

        {/* x-axis day labels */}
        {points.map((p, i) =>
          i % labelStep === 0 ? (
            <text
              key={`lbl-${p.day}`}
              x={xCenter(i)}
              y={VIEW_H - 10}
              textAnchor="middle"
              fontSize={9}
              fill="rgb(var(--trace-muted))"
            >
              {shortDay(p.day)}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}
