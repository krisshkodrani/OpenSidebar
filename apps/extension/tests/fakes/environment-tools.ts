/**
 * In-memory fakes for the Phase 4b tool API-family ports (RFC LP-15). Seeds the
 * Phase 5 fake-environment kit.
 */

import type {
  CookieRecord,
  CookiesPort,
  DownloadsPort,
  HistoryItemRecord,
  HistoryPort,
  SearchPort,
  WindowsPort,
} from "../../src/background/environment/types";

export interface FakeDownloadsPort extends DownloadsPort {
  readonly downloads: Array<{ url: string; filename?: string; id: number }>;
}

export function createFakeDownloadsPort(available = true): FakeDownloadsPort {
  const downloads: Array<{ url: string; filename?: string; id: number }> = [];
  let nextId = 1;
  return {
    downloads,
    isAvailable: () => available,
    async download(options) {
      const id = nextId++;
      downloads.push({ ...options, id });
      return id;
    },
  };
}

export interface FakeCookiesPort extends CookiesPort {
  readonly jar: CookieRecord[];
}

export function createFakeCookiesPort(seed: CookieRecord[] = []): FakeCookiesPort {
  const jar: CookieRecord[] = [...seed];
  return {
    jar,
    async getAll(details) {
      // Fakes ignore url matching beyond presence; return the whole jar.
      return details.name
        ? jar.filter((c) => c.name === details.name)
        : [...jar];
    },
    async set(details) {
      const existing = jar.findIndex((c) => c.name === details.name);
      const record: CookieRecord = {
        name: details.name,
        value: details.value,
        domain: details.domain,
        path: details.path,
      };
      if (existing >= 0) jar[existing] = record;
      else jar.push(record);
    },
    async remove(details) {
      const idx = jar.findIndex((c) => c.name === details.name);
      if (idx >= 0) jar.splice(idx, 1);
    },
  };
}

export function createFakeHistoryPort(items: HistoryItemRecord[] = []): HistoryPort {
  return {
    async search(query) {
      const matched = items.filter((i) =>
        (i.title ?? "").toLowerCase().includes(query.text.toLowerCase()),
      );
      return query.maxResults ? matched.slice(0, query.maxResults) : matched;
    },
  };
}

export interface FakeSearchPort extends SearchPort {
  readonly queries: Array<{ text: string; disposition?: string }>;
}

export function createFakeSearchPort(): FakeSearchPort {
  const queries: Array<{ text: string; disposition?: string }> = [];
  return {
    queries,
    async query(options) {
      queries.push({ text: options.text, disposition: options.disposition });
    },
  };
}

export interface FakeWindowsPort extends WindowsPort {
  readonly created: Array<{ url?: string; id: number }>;
}

export function createFakeWindowsPort(): FakeWindowsPort {
  const created: Array<{ url?: string; id: number }> = [];
  let nextId = 100;
  return {
    created,
    async create(options) {
      const id = nextId++;
      created.push({ url: options.url, id });
      return { id };
    },
  };
}
