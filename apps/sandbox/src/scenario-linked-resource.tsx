import type { JsonValue } from "@opensidebar/scenario-contracts";

function objectValue(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function display(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function ScenarioLinkedResourceLink({ value }: { value: JsonValue | undefined }) {
  const resource = objectValue(value);
  if (typeof resource.href !== "string" || typeof resource.label !== "string") {
    return null;
  }
  return (
    <section className="scenario-panel scenario-linked-resource">
      <h2>Linked record</h2>
      {typeof resource.description === "string" && <p>{resource.description}</p>}
      <a className="scenario-primary" href={resource.href} target="_blank" rel="noreferrer">
        {resource.label}
      </a>
    </section>
  );
}

export function ScenarioLinkedResourcePage({ value }: { value: JsonValue | undefined }) {
  const resource = objectValue(value);
  const evidence = Array.isArray(resource.evidence) ? resource.evidence : [];
  if (!evidence.length) return null;
  return (
    <main className="scenario-resource-page">
      <p>Continuity Lab · linked record</p>
      <h1>{display(resource.title)}</h1>
      <section className="scenario-panel">
        <h2>Shipping details</h2>
        <dl className="scenario-evidence">
          {evidence.map((entry, index) => {
            const item = objectValue(entry);
            return (
              <div key={index}>
                <dt>{display(item.label)}</dt>
                <dd>{display(item.value)}</dd>
              </div>
            );
          })}
        </dl>
      </section>
    </main>
  );
}
