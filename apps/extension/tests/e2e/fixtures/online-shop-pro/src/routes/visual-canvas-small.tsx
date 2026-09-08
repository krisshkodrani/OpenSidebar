import { useEffect, useRef } from "react";

/**
 * LP-13 region-zoom fixture: the requested value ("Q3 net margin: 4.7%")
 * exists ONLY as canvas-painted fine print — absent from the DOM, SVG, and
 * accessibility tree. It rewards region zoom while remaining above the
 * capture/OCR noise floor.
 */
export default function VisualCanvasSmall() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#0f172a";
    ctx.font = "700 26px Arial";
    ctx.fillText("Annual Performance Overview", 40, 48);

    const bars = [
      { label: "Q1", value: 38, color: "#64748b" },
      { label: "Q2", value: 51, color: "#64748b" },
      { label: "Q3", value: 66, color: "#0f766e" },
      { label: "Q4", value: 58, color: "#64748b" },
    ];

    ctx.font = "600 16px Arial";
    bars.forEach((bar, index) => {
      const x = 70 + index * 130;
      const height = bar.value * 2.6;
      const y = 260 - height;
      ctx.fillStyle = bar.color;
      ctx.fillRect(x, y, 76, height);
      ctx.fillStyle = "#0f172a";
      ctx.fillText(bar.label, x + 26, 286);
    });

    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, 260);
    ctx.lineTo(600, 260);
    ctx.stroke();

    // The previous 8px text sat on the capture/OCR noise floor and measured
    // glyph luck instead of region selection. Keep the evidence small but
    // reliably recoverable from a crop.
    ctx.fillStyle = "#1e293b";
    ctx.font = "400 11px Arial";
    const finePrint = [
      "Figures unaudited. Q1 net margin: 2.1%; churn 4.4%; NRR 101.2%. Q2 net margin: 3.3%; churn 3.9%; NRR 103.8%.",
      "Q3 net margin: 4.7%; churn 3.1%; NRR 106.4%. Q4 net margin: 3.9%; churn 3.5%; NRR 104.9%.",
      "Margins exclude one-time restructuring charges of 0.6pp in Q3 and 0.2pp in Q4. Basis: ASC 606.",
    ];
    finePrint.forEach((line, index) => {
      ctx.fillText(line, 40, 320 + index * 14);
    });
  }, []);

  return (
    <div className="fixture-static">
      <div className="header">
        <h1>Annual Performance Overview</h1>
      </div>
      <main style={{ padding: "0 24px", maxWidth: 960, margin: "0 auto" }}>
        <p style={{ color: "#475569", maxWidth: 680 }}>
          The report below is rendered onto a canvas. Detailed quarterly
          metrics appear only in the fine print under the chart.
        </p>
        <canvas
          ref={canvasRef}
          width={660}
          height={380}
          aria-label="Annual performance chart with fine-print footnotes"
          style={{
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            background: "#f8fafc",
            display: "block",
            marginTop: 20,
          }}
        />
      </main>
    </div>
  );
}
