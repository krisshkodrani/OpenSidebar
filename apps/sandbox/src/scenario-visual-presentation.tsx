import type { JsonObject, JsonValue } from "@opensidebar/scenario-contracts";

function objectValue(value: JsonValue | undefined): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: JsonValue | undefined): string {
  return value === undefined || value === null ? "" : String(value);
}

function items(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.map(objectValue) : [];
}

export function ScenarioVisualPresentation({ value }: { value: JsonValue | undefined }) {
  const presentation = objectValue(value);
  const kind = text(presentation.kind);
  const entries = items(presentation.items);
  if (!kind || entries.length === 0) return null;

  if (kind === "bar-chart" || kind === "tooltip-chart") {
    const tooltip = kind === "tooltip-chart";
    return <section className="scenario-panel scenario-visual"><h2>{tooltip ? "Campaign CPA" : "Weekly qualified leads"}</h2><div className="scenario-chart">{entries.map((entry) => {
      const height = Number(entry.height ?? entry.value ?? 20);
      return <div className="scenario-chart-column" key={text(entry.label)}><div className={`scenario-chart-value ${tooltip ? "scenario-tooltip" : ""}`} tabIndex={tooltip ? 0 : undefined} style={{ height: `${Math.max(18, Math.min(height, 100)) * 1.6}px` }}>{tooltip && <span role="tooltip">{text(entry.label)} · {text(entry.value)}</span>}{!tooltip && <small>{text(entry.value)}</small>}</div><span>{text(entry.label)}</span></div>;
    })}</div></section>;
  }

  if (kind === "clipped-table") {
    return <section className="scenario-panel scenario-visual"><h2>Renewal contracts</h2><table><thead><tr><th>Account</th><th>Contract ID</th></tr></thead><tbody>{entries.map((entry) => <tr key={text(entry.label)}><td>{text(entry.label)}</td><td><span className={entry.clipped === true ? "scenario-clipped" : ""} tabIndex={entry.clipped === true ? 0 : undefined} data-full-value={entry.clipped === true ? text(entry.code) : undefined}>{text(entry.code)}</span></td></tr>)}</tbody></table></section>;
  }

  if (kind === "footnote" || kind === "document-scan") {
    return <section className={`scenario-panel scenario-visual scenario-paper ${kind === "document-scan" ? "scenario-scan" : ""}`}><h2>{kind === "footnote" ? "Article" : "Policy scan"}</h2>{entries.map((entry, index) => <div className={text(entry.label) === "Shaded note" ? "scenario-shaded-note" : "scenario-paper-row"} key={`${text(entry.label)}-${index}`}><strong>{text(entry.label)}</strong><p>{text(entry.detail)}</p></div>)}</section>;
  }

  return <section className="scenario-panel scenario-visual"><h2>{kind === "stock-badges" ? "Color availability" : kind === "inventory-labels" ? "Inventory labels" : kind === "channel-list" ? "Channels" : kind === "status-tile" ? "Live status" : "Open tickets"}</h2><div className={`scenario-visual-list ${kind}`}>{entries.map((entry) => <div className="scenario-visual-item" key={text(entry.label)}><span className={`scenario-marker tone-${text(entry.tone)}`} data-shape={text(entry.shape)} aria-hidden="true" /><div><strong>{text(entry.label)}</strong>{entry.detail !== undefined && <p>{text(entry.detail)}</p>}{entry.code !== undefined && <code>{text(entry.code)}</code>}</div>{entry.badge !== undefined && <span className={`scenario-badge tone-${text(entry.tone)}`}>{text(entry.badge)}</span>}</div>)}</div></section>;
}

export function ScenarioEmbeddedContent({ value }: { value: JsonValue | undefined }) {
  const safety = objectValue(value);
  const content = text(safety.untrustedContent);
  if (!content) return null;
  return <section className="scenario-panel scenario-embedded-content"><h2>{text(safety.sourceLabel) || "Submitted content"}</h2><div className="scenario-embedded-author"><span aria-hidden="true">E</span><div><strong>External contributor</strong><small>Content supplied with this record</small></div></div><blockquote>{content}</blockquote></section>;
}
