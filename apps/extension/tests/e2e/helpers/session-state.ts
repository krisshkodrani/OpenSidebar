import type { CookieParam, Page } from "puppeteer";

type SameSite = "Strict" | "Lax" | "None";

export interface PlaywrightStorageStateCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: SameSite;
}

export interface PlaywrightStorageEntry {
  name: string;
  value: string;
}

export interface PlaywrightStorageOrigin {
  origin: string;
  localStorage?: PlaywrightStorageEntry[];
  sessionStorage?: PlaywrightStorageEntry[];
}

export interface PlaywrightStorageState {
  cookies?: PlaywrightStorageStateCookie[];
  origins?: PlaywrightStorageOrigin[];
}

export interface StorageStateImportOptions {
  finalUrl?: string;
}

export interface StorageStateImportResult {
  cookies: number;
  localStorage: number;
  sessionStorage: number;
  origins: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid storage state: ${field} must be a string`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, field);
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`Invalid storage state: ${field} must be a boolean`);
  }
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Invalid storage state: ${field} must be a number`);
  }
  return value;
}

function optionalSameSite(value: unknown, field: string): SameSite | undefined {
  if (value === undefined) return undefined;
  if (value !== "Strict" && value !== "Lax" && value !== "None") {
    throw new Error(`Invalid storage state: ${field} must be Strict, Lax, or None`);
  }
  return value;
}

function normalizeEntries(
  value: unknown,
  field: string,
): PlaywrightStorageEntry[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`Invalid storage state: ${field} must be an array`);
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid storage state: ${field}[${index}] must be an object`);
    }
    return {
      name: requireString(entry.name, `${field}[${index}].name`),
      value: requireString(entry.value, `${field}[${index}].value`),
    };
  });
}

export function normalizePlaywrightStorageState(
  raw: unknown,
): PlaywrightStorageState {
  if (!isRecord(raw)) {
    throw new Error("Invalid storage state: root must be an object");
  }

  const cookiesRaw = raw.cookies;
  const originsRaw = raw.origins;

  if (cookiesRaw !== undefined && !Array.isArray(cookiesRaw)) {
    throw new Error("Invalid storage state: cookies must be an array");
  }
  if (originsRaw !== undefined && !Array.isArray(originsRaw)) {
    throw new Error("Invalid storage state: origins must be an array");
  }

  const cookies = cookiesRaw?.map((cookie, index) => {
    if (!isRecord(cookie)) {
      throw new Error(`Invalid storage state: cookies[${index}] must be an object`);
    }
    return {
      name: requireString(cookie.name, `cookies[${index}].name`),
      value: requireString(cookie.value, `cookies[${index}].value`),
      domain: optionalString(cookie.domain, `cookies[${index}].domain`),
      path: optionalString(cookie.path, `cookies[${index}].path`),
      expires: optionalNumber(cookie.expires, `cookies[${index}].expires`),
      httpOnly: optionalBoolean(cookie.httpOnly, `cookies[${index}].httpOnly`),
      secure: optionalBoolean(cookie.secure, `cookies[${index}].secure`),
      sameSite: optionalSameSite(cookie.sameSite, `cookies[${index}].sameSite`),
    };
  });

  const origins = originsRaw?.map((origin, index) => {
    if (!isRecord(origin)) {
      throw new Error(`Invalid storage state: origins[${index}] must be an object`);
    }
    const normalizedOrigin = requireString(origin.origin, `origins[${index}].origin`);
    new URL(normalizedOrigin);
    return {
      origin: normalizedOrigin,
      localStorage: normalizeEntries(
        origin.localStorage,
        `origins[${index}].localStorage`,
      ),
      sessionStorage: normalizeEntries(
        origin.sessionStorage,
        `origins[${index}].sessionStorage`,
      ),
    };
  });

  return {
    cookies: cookies ?? [],
    origins: origins ?? [],
  };
}

export function listStorageStateOrigins(raw: unknown): string[] {
  return normalizePlaywrightStorageState(raw).origins?.map((origin) => origin.origin) ?? [];
}

function toPuppeteerCookie(
  cookie: PlaywrightStorageStateCookie,
): CookieParam {
  const converted: CookieParam = {
    name: cookie.name,
    value: cookie.value,
  };
  if (cookie.domain) converted.domain = cookie.domain;
  if (cookie.path) converted.path = cookie.path;
  if (cookie.secure !== undefined) converted.secure = cookie.secure;
  if (cookie.httpOnly !== undefined) converted.httpOnly = cookie.httpOnly;
  if (cookie.sameSite) converted.sameSite = cookie.sameSite;
  if (typeof cookie.expires === "number" && cookie.expires >= 0) {
    converted.expires = cookie.expires;
  }
  return converted;
}

export async function importPlaywrightStorageState(
  page: Page,
  raw: unknown,
  options: StorageStateImportOptions = {},
): Promise<StorageStateImportResult> {
  const state = normalizePlaywrightStorageState(raw);
  const cookies = state.cookies ?? [];
  const origins = state.origins ?? [];

  if (cookies.length > 0) {
    await page.setCookie(...cookies.map(toPuppeteerCookie));
  }

  let localStorage = 0;
  let sessionStorage = 0;
  for (const origin of origins) {
    const localStorageEntries = origin.localStorage ?? [];
    const sessionStorageEntries = origin.sessionStorage ?? [];
    if (localStorageEntries.length === 0 && sessionStorageEntries.length === 0) {
      continue;
    }

    await page.goto(origin.origin, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      (payload) => {
        for (const entry of payload.localStorageEntries) {
          window.localStorage.setItem(entry.name, entry.value);
        }
        for (const entry of payload.sessionStorageEntries) {
          window.sessionStorage.setItem(entry.name, entry.value);
        }
      },
      { localStorageEntries, sessionStorageEntries },
    );
    localStorage += localStorageEntries.length;
    sessionStorage += sessionStorageEntries.length;
  }

  if (options.finalUrl) {
    await page.goto(options.finalUrl, { waitUntil: "domcontentloaded" });
  }

  return {
    cookies: cookies.length,
    localStorage,
    sessionStorage,
    origins: origins.map((origin) => origin.origin),
  };
}
