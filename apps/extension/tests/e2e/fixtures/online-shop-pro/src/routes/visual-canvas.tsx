import { useEffect, useRef } from "react";

export default function VisualCanvas() {
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
    ctx.font = "700 28px Arial";
    ctx.fillText("Quarterly Reliability Score", 40, 52);

    const bars = [
      { label: "Q1", value: 41, color: "#64748b" },
      { label: "Q2", value: 53, color: "#64748b" },
      { label: "Q3", value: 64, color: "#64748b" },
      { label: "Q4", value: 72, color: "#0f766e" },
    ];

    ctx.font = "600 18px Arial";
    bars.forEach((bar, index) => {
      const x = 70 + index * 120;
      const height = bar.value * 3;
      const y = 300 - height;
      ctx.fillStyle = bar.color;
      ctx.fillRect(x, y, 70, height);
      ctx.fillStyle = "#0f172a";
      ctx.fillText(bar.label, x + 20, 330);
      ctx.fillText(String(bar.value), x + 18, y - 12);
    });

    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, 300);
    ctx.lineTo(590, 300);
    ctx.stroke();

    ctx.fillStyle = "#0f766e";
    ctx.font = "700 24px Arial";
    ctx.fillText("Highlighted Q4 score: 72", 300, 390);
  }, []);

  return (
    <div className="fixture-static">
      <div className="header">
        <h1>Visual Canvas Report</h1>
      </div>
      <main style={{ padding: "0 24px", maxWidth: 900, margin: "0 auto" }}>
        <p style={{ color: "#475569", maxWidth: 640 }}>
          The chart below is rendered onto a canvas so the exact highlighted
          value must be read visually.
        </p>
        <canvas
          ref={canvasRef}
          width={640}
          height={420}
          aria-label="Quarterly reliability score chart"
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
