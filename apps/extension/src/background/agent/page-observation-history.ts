import type { DomSnapshot } from "../../types";
import { sanitizeForPrompt } from "../security";
import { formatSnapshotElements } from "./context-formatting";

const MAX_OBSERVATIONS = 12;
const MAX_TOTAL_CHARS = 24_000;

/** Keep observed states in order, independently of model-written summaries. */
export function boundPageObservations(observations: readonly string[]): string[] {
  const retained: string[] = [];
  let chars = 0;
  for (let i = observations.length - 1; i >= 0; i--) {
    const observation = observations[i];
    if (retained[0] === observation) continue;
    if (retained.length >= MAX_OBSERVATIONS || chars + observation.length > MAX_TOTAL_CHARS) break;
    retained.unshift(observation);
    chars += observation.length;
  }
  return retained;
}

export class PageObservationHistory {
  private observations: string[] = [];

  record(snapshot: DomSnapshot): void {
    const rendered = sanitizeForPrompt(JSON.stringify({
      url: snapshot.url.slice(0, 1000),
      title: snapshot.title.slice(0, 300),
      content: (snapshot.pageContent || snapshot.visibleContent || "").slice(0, 4000),
      controls: formatSnapshotElements(snapshot.elements
        .filter((element) => element.isVisible && element.attributes.type !== "password")
        .slice(0, 40)).slice(0, 2000),
    }));
    // Escaping can expand page text beyond its input character budget.
    const observation = rendered.length > 8000
      ? `${rendered.slice(0, 7900)}\n[Page observation truncated]`
      : rendered;
    this.observations = boundPageObservations([...this.observations, observation]);
  }

  toArray(): string[] { return [...this.observations]; }
  clear(): void { this.observations = []; }
}
