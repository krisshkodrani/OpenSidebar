import type { ProviderConfig } from "./types";

const COOLDOWN_MS = 60_000;

export interface ProviderSlot {
  provider: ProviderConfig;
  cooldownUntil: number;
  model: string;
}

export interface ProviderPoolSlotInput {
  provider: ProviderConfig;
  model: string;
  cooldownUntil?: number;
}

export interface ProviderPoolConfig {
  slots: ProviderPoolSlotInput[];
}

export class ProviderPool {
  private slots: ProviderSlot[];

  constructor(config: ProviderPoolConfig) {
    if (config.slots.length === 0) {
      throw new Error("ProviderPool requires at least one provider slot");
    }
    this.slots = config.slots.map((slot) => ({
      provider: slot.provider,
      cooldownUntil: slot.cooldownUntil ?? 0,
      model: slot.model,
    }));
  }

  /** Returns highest-priority provider not on cooldown */
  getActive(): ProviderSlot {
    const now = Date.now();
    return (
      this.slots.find((s) => now >= s.cooldownUntil) ??
      this.slots[this.slots.length - 1]
    );
  }

  /** Mark a provider as rate-limited */
  cooldown(providerId: string): void {
    const slot = this.slots.find((s) => s.provider.providerId === providerId);
    if (slot) slot.cooldownUntil = Date.now() + COOLDOWN_MS;
  }

  /** Get next provider in chain for immediate failover */
  getNextFallback(afterProviderId: string): ProviderSlot | null {
    const idx = this.slots.findIndex(
      (s) => s.provider.providerId === afterProviderId,
    );
    if (idx === -1 || idx >= this.slots.length - 1) return null;
    const now = Date.now();
    for (let i = idx + 1; i < this.slots.length; i++) {
      if (now >= this.slots[i].cooldownUntil) return this.slots[i];
    }
    return this.slots[this.slots.length - 1];
  }

  /** Permanently disable a provider for the rest of this session (e.g. 402 credit exhaustion) */
  disableForSession(providerId: string): void {
    const slot = this.slots.find((s) => s.provider.providerId === providerId);
    if (slot) slot.cooldownUntil = Number.MAX_SAFE_INTEGER;
  }

  /** Check if a provider has been permanently disabled this session */
  isDisabled(providerId: string): boolean {
    const slot = this.slots.find((s) => s.provider.providerId === providerId);
    return slot ? slot.cooldownUntil === Number.MAX_SAFE_INTEGER : false;
  }

  /** True when every provider slot is on cooldown or permanently disabled */
  allDisabled(): boolean {
    return this.slots.every((s) => Date.now() < s.cooldownUntil);
  }

  /** Get all slots (for testing) */
  getSlots(): ProviderSlot[] {
    return this.slots;
  }
}
