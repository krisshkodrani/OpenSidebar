/**
 * Standalone fixture server for demos, screenshots, and video recording.
 *
 * Serves the E2E fixture pages on http://localhost:3333 with a landing page
 * that links to all available demos. Use these pages with the extension loaded
 * to capture screenshots or record demo videos.
 *
 * Usage:  npm run fixtures
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../tests/e2e/fixtures");
const PORT = 3333;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

interface FixtureInfo {
  filename: string;
  title: string;
  description: string;
  difficulty: string;
  color: string;
}

const FIXTURES: FixtureInfo[] = [
  {
    filename: "summarize-page.html",
    title: "Page Summarization",
    description: "Static article page. Ask the agent to summarize it — tests read-only comprehension with no clicks needed.",
    difficulty: "Simple",
    color: "#22c55e",
  },
  {
    filename: "article-research.html",
    title: "Article Research",
    description: "Long article with footnotes below the fold. Ask the agent to find a specific citation — tests scrolling and information extraction.",
    difficulty: "Simple",
    color: "#22c55e",
  },
  {
    filename: "navigation-challenge.html",
    title: "Navigation Challenge",
    description: "Click a button 3 times, read a revealed code, type it in, and submit. Tests sequential interaction and reading dynamic content.",
    difficulty: "Medium",
    color: "#eab308",
  },
  {
    filename: "dashboard.html",
    title: "Analytics Dashboard",
    description: "Data tables, tab panels, and a settings form behind a tab. Ask the agent to switch tabs and save settings.",
    difficulty: "Medium",
    color: "#eab308",
  },
  {
    filename: "online-shop-pro.html",
    title: "Online Shopping",
    description: "Full e-commerce store with 8 products, Unsplash photos, filters, cart, coupon codes, shipping, and checkout. Great for demo videos.",
    difficulty: "Complex",
    color: "#f97316",
  },
  {
    filename: "multi-step-form.html",
    title: "Multi-Step Form Wizard",
    description: "3-step wizard with conditional fields (dropdown reveals extra inputs), validation, and a review step.",
    difficulty: "Complex",
    color: "#f97316",
  },
  {
    filename: "error-scenarios.html",
    title: "Error Scenarios",
    description: "Form validation errors, delayed content loading, and an impossible task. Tests error recovery and graceful failure.",
    difficulty: "Edge Cases",
    color: "#ef4444",
  },
];

function buildIndexPage(): string {
  const cards = FIXTURES.map(
    (f) => `
      <a href="/${f.filename}" class="card">
        <div class="card-header">
          <h2>${f.title}</h2>
          <span class="badge" style="background: ${f.color}20; color: ${f.color}; border: 1px solid ${f.color}40">${f.difficulty}</span>
        </div>
        <p>${f.description}</p>
        <div class="card-footer">
          <code>${f.filename}</code>
          <span class="arrow">&rarr;</span>
        </div>
      </a>`,
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenSidebar Demo Fixtures</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
    }
    .header {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border-bottom: 1px solid #334155;
      padding: 2rem 0;
      text-align: center;
    }
    .header h1 {
      font-size: 1.75rem;
      font-weight: 700;
      color: #f8fafc;
      margin-bottom: 0.5rem;
    }
    .header p {
      color: #94a3b8;
      font-size: 0.95rem;
      max-width: 600px;
      margin: 0 auto;
      line-height: 1.5;
    }
    .header .hint {
      margin-top: 1rem;
      padding: 0.75rem 1.25rem;
      background: #1e3a5f;
      border: 1px solid #2563eb40;
      border-radius: 8px;
      color: #93c5fd;
      font-size: 0.85rem;
      display: inline-block;
    }
    .grid {
      max-width: 960px;
      margin: 2rem auto;
      padding: 0 1.5rem;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
      gap: 1rem;
    }
    .card {
      display: block;
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
      text-decoration: none;
      color: inherit;
      transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
    }
    .card:hover {
      border-color: #3b82f6;
      transform: translateY(-2px);
      box-shadow: 0 4px 20px rgba(59, 130, 246, 0.15);
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.75rem;
    }
    .card-header h2 {
      font-size: 1.1rem;
      font-weight: 600;
      color: #f1f5f9;
    }
    .badge {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 0.2rem 0.6rem;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      white-space: nowrap;
    }
    .card p {
      font-size: 0.875rem;
      color: #94a3b8;
      line-height: 1.55;
      margin-bottom: 1rem;
    }
    .card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .card-footer code {
      font-size: 0.75rem;
      color: #64748b;
      background: #0f172a;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
    }
    .arrow {
      color: #3b82f6;
      font-size: 1.2rem;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .card:hover .arrow { opacity: 1; }
    .footer {
      text-align: center;
      padding: 2rem;
      color: #475569;
      font-size: 0.8rem;
    }
    @media (max-width: 520px) {
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>OpenSidebar Demo Fixtures</h1>
    <p>Interactive pages for testing the browser agent. Open any page, then use the OpenSidebar side panel to give the agent a task.</p>
    <div class="hint">
      Tip: Open the side panel first, then click a fixture below. The agent needs a page loaded to work.
    </div>
  </div>
  <div class="grid">
    ${cards}
  </div>
  <div class="footer">
    Served from tests/e2e/fixtures/ &middot; Port ${PORT}
  </div>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const urlPath = req.url?.split("?")[0] ?? "/";

  // Landing page
  if (urlPath === "/" || urlPath === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(buildIndexPage());
    return;
  }

  // Serve fixture files
  const filename = urlPath.slice(1);
  const filePath = path.join(FIXTURES_DIR, filename);

  // Block path traversal
  if (!filePath.startsWith(FIXTURES_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { "Content-Type": contentType });
  res.end(content);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  OpenSidebar Demo Fixtures`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  ${FIXTURES.length} fixtures available:\n`);
  for (const f of FIXTURES) {
    const pad = " ".repeat(Math.max(0, 24 - f.title.length));
    console.log(`    ${f.title}${pad}  http://localhost:${PORT}/${f.filename}`);
  }
  console.log(`\n  Press Ctrl+C to stop\n`);
});
