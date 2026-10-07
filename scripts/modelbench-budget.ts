import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

export interface BudgetEntry {
  id: string;
  label: string;
  reservedUsd: number;
  actualUsd?: number;
  /** Unknown bill conservatively charged against the cap at the entire reservation. */
  heldMaximum?: { reason: string };
}
interface Ledger {
  version: 1;
  capUsd: number;
  entries: BudgetEntry[];
}

/** One campaign, one durable ledger. Unknown charges block dispatch unless fully held. */
export class ModelBenchBudget {
  private ledger: Ledger;
  private lock: number;
  private closed = false;
  constructor(
    private path: string,
    capUsd: number,
  ) {
    if (!Number.isFinite(capUsd) || capUsd <= 0) throw new Error("Invalid cap");
    this.lock = openSync(`${path}.lock`, "wx");
    try {
      this.ledger = existsSync(path)
        ? (JSON.parse(readFileSync(path, "utf8")) as Ledger)
        : { version: 1, capUsd, entries: [] };
      if (
        this.ledger.version !== 1 ||
        this.ledger.capUsd !== capUsd ||
        !Array.isArray(this.ledger.entries) ||
        this.ledger.entries.some(
          (entry) =>
            !Number.isFinite(entry.reservedUsd) ||
            entry.reservedUsd <= 0 ||
            (entry.heldMaximum !== undefined &&
              (typeof entry.heldMaximum?.reason !== "string" || !entry.heldMaximum.reason.trim())) ||
            (entry.actualUsd !== undefined &&
              (!Number.isFinite(entry.actualUsd) || entry.actualUsd < 0)),
        )
      ) {
        throw new Error("Invalid ledger or changed campaign cap");
      }
      this.persist();
    } catch (error) {
      this.close();
      throw error;
    }
  }
  private persist() {
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.ledger, null, 2));
    renameSync(`${this.path}.tmp`, this.path);
  }
  /** Read-only admission check; does not create or settle a reservation. */
  assertCanReserve(maximumUsd: number): void {
    if (this.closed) throw new Error("Budget ledger is closed");
    if (this.ledger.entries.some((entry) => entry.actualUsd === undefined && !entry.heldMaximum)) {
      throw new Error("Unaccounted request: paid dispatch blocked");
    }
    const spent = this.ledger.entries.reduce(
      (sum, entry) => sum + (entry.actualUsd ?? entry.reservedUsd),
      0,
    );
    if (
      !Number.isFinite(maximumUsd) ||
      maximumUsd <= 0 ||
      spent + maximumUsd > this.ledger.capUsd
    ) {
      throw new Error("Campaign spending cap would be exceeded");
    }
  }
  reserve(label: string, maximumUsd: number): string {
    this.assertCanReserve(maximumUsd);
    const id = String(this.ledger.entries.length + 1);
    this.ledger.entries.push({ id, label, reservedUsd: maximumUsd });
    this.persist();
    return id;
  }
  settle(id: string, actualUsd: unknown) {
    if (this.closed) throw new Error("Budget ledger is closed");
    const entry = this.ledger.entries.find((item) => item.id === id);
    if (!entry || entry.actualUsd !== undefined)
      throw new Error("Unknown or settled reservation");
    if (
      typeof actualUsd !== "number" ||
      !Number.isFinite(actualUsd) ||
      actualUsd < 0 ||
      actualUsd > entry.reservedUsd
    ) {
      throw new Error(
        "Missing or excessive cost: reservation retained; dispatch blocked",
      );
    }
    entry.actualUsd = actualUsd;
    this.persist();
  }
  retainMaximumCharge(id: string, reason: string) {
    if (this.closed) throw new Error("Budget ledger is closed");
    const entry = this.ledger.entries.find((item) => item.id === id);
    if (!entry || entry.actualUsd !== undefined || entry.heldMaximum)
      throw new Error("Unknown or accounted reservation");
    if (!reason.trim()) throw new Error("A reason is required for retaining the maximum charge");
    entry.heldMaximum = { reason };
    this.persist();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.lock);
    unlinkSync(`${this.path}.lock`);
  }
}
