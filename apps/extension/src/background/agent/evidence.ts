import { EvidenceEvent, EvidenceEventType, isTrustedEvidence } from "../../types";

export class EvidenceAccumulator {
  private events: EvidenceEvent[] = [];

  add(event: EvidenceEvent): boolean {
    if (!isTrustedEvidence(event)) return false;
    const key = this.keyFor(event);
    if (this.events.some((existing) => this.keyFor(existing) === key)) {
      return false;
    }
    this.events.push(event);
    return true;
  }

  addMany(events: EvidenceEvent[] | undefined): number {
    if (!Array.isArray(events)) return 0;
    let added = 0;
    for (const event of events) {
      if (this.add(event)) added++;
    }
    return added;
  }

  hasType(type: EvidenceEventType): boolean {
    return this.events.some((event) => event.type === type);
  }

  getByType(type: EvidenceEventType): EvidenceEvent[] {
    return this.events.filter((event) => event.type === type);
  }

  hasConflict(): boolean {
    return this.events.some((event) => event.type === "uncertainty_detected");
  }

  toArray(): EvidenceEvent[] {
    return [...this.events];
  }

  private keyFor(event: EvidenceEvent): string {
    return JSON.stringify({
      type: event.type,
      source: event.source,
      detail: event.detail ?? {},
    });
  }
}

