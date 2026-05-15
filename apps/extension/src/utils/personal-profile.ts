export const PERSONAL_PROFILE_STORAGE_KEY = "opensidebar:personalProfile";

export type PersonalProfileStorageKeys =
  | string
  | string[]
  | Record<string, unknown>
  | null
  | undefined;

export interface PersonalProfileStorageArea {
  get(keys?: PersonalProfileStorageKeys): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface PersonalProfileStorage {
  local: PersonalProfileStorageArea;
}

export interface PersonalProfile {
  identity: {
    first_name: string;
    last_name: string;
    preferred_name: string;
    pronouns: string;
  };
  contact: {
    email: string;
    phone: string;
    location: string;
    address: {
      line1: string;
      line2: string;
      city: string;
      state: string;
      postal_code: string;
      country: string;
    };
  };
  links: {
    linkedin: string;
    portfolio: string;
    github: string;
    website: string;
  };
  preferences: {
    roles: string[];
    locations: string[];
    work_modes: string[];
    salary_expectation: string;
    available_from: string;
  };
  authorization: {
    work_authorized: string;
    sponsorship_required: string;
    relocation: string;
  };
  answers: {
    availability: string;
    why_interested: string;
    cover_note: string;
  };
  sensitive: {
    eeo: {
      gender: string;
      race_ethnicity: string;
      veteran_status: string;
      disability_status: string;
    };
  };
}

export interface PersonalizationState {
  version: 1;
  enabled: boolean;
  updatedAt: number;
  profile: PersonalProfile;
}

export interface ProfileResolveResult {
  values: Record<string, unknown>;
  missing: string[];
  disabled?: boolean;
}

export const EMPTY_PERSONAL_PROFILE: PersonalProfile = {
  identity: {
    first_name: "",
    last_name: "",
    preferred_name: "",
    pronouns: "",
  },
  contact: {
    email: "",
    phone: "",
    location: "",
    address: {
      line1: "",
      line2: "",
      city: "",
      state: "",
      postal_code: "",
      country: "",
    },
  },
  links: {
    linkedin: "",
    portfolio: "",
    github: "",
    website: "",
  },
  preferences: {
    roles: [],
    locations: [],
    work_modes: [],
    salary_expectation: "",
    available_from: "",
  },
  authorization: {
    work_authorized: "",
    sponsorship_required: "",
    relocation: "",
  },
  answers: {
    availability: "",
    why_interested: "",
    cover_note: "",
  },
  sensitive: {
    eeo: {
      gender: "",
      race_ethnicity: "",
      veteran_status: "",
      disability_status: "",
    },
  },
};

export const EMPTY_PERSONALIZATION_STATE: PersonalizationState = {
  version: 1,
  enabled: false,
  updatedAt: 0,
  profile: EMPTY_PERSONAL_PROFILE,
};

const APPLICATION_TASK_PATTERN =
  /\b(apply|application|job|role|position|career|cover letter|resume|cv|form)\b/i;

function cloneProfile(profile: PersonalProfile): PersonalProfile {
  return JSON.parse(JSON.stringify(profile)) as PersonalProfile;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeProfile(input: unknown): PersonalProfile {
  const source =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const identity = (source.identity ?? {}) as Record<string, unknown>;
  const contact = (source.contact ?? {}) as Record<string, unknown>;
  const address = (contact.address ?? {}) as Record<string, unknown>;
  const links = (source.links ?? {}) as Record<string, unknown>;
  const preferences = (source.preferences ?? {}) as Record<string, unknown>;
  const authorization = (source.authorization ?? {}) as Record<string, unknown>;
  const answers = (source.answers ?? {}) as Record<string, unknown>;
  const sensitive = (source.sensitive ?? {}) as Record<string, unknown>;
  const eeo = (sensitive.eeo ?? {}) as Record<string, unknown>;

  return {
    identity: {
      first_name: stringValue(identity.first_name),
      last_name: stringValue(identity.last_name),
      preferred_name: stringValue(identity.preferred_name),
      pronouns: stringValue(identity.pronouns),
    },
    contact: {
      email: stringValue(contact.email),
      phone: stringValue(contact.phone),
      location: stringValue(contact.location),
      address: {
        line1: stringValue(address.line1),
        line2: stringValue(address.line2),
        city: stringValue(address.city),
        state: stringValue(address.state),
        postal_code: stringValue(address.postal_code),
        country: stringValue(address.country),
      },
    },
    links: {
      linkedin: stringValue(links.linkedin),
      portfolio: stringValue(links.portfolio),
      github: stringValue(links.github),
      website: stringValue(links.website),
    },
    preferences: {
      roles: stringArray(preferences.roles),
      locations: stringArray(preferences.locations),
      work_modes: stringArray(preferences.work_modes),
      salary_expectation: stringValue(preferences.salary_expectation),
      available_from: stringValue(preferences.available_from),
    },
    authorization: {
      work_authorized: stringValue(authorization.work_authorized),
      sponsorship_required: stringValue(authorization.sponsorship_required),
      relocation: stringValue(authorization.relocation),
    },
    answers: {
      availability: stringValue(answers.availability),
      why_interested: stringValue(answers.why_interested),
      cover_note: stringValue(answers.cover_note),
    },
    sensitive: {
      eeo: {
        gender: stringValue(eeo.gender),
        race_ethnicity: stringValue(eeo.race_ethnicity),
        veteran_status: stringValue(eeo.veteran_status),
        disability_status: stringValue(eeo.disability_status),
      },
    },
  };
}

function normalizeState(input: unknown): PersonalizationState {
  if (!input || typeof input !== "object") {
    return {
      ...EMPTY_PERSONALIZATION_STATE,
      profile: cloneProfile(EMPTY_PERSONAL_PROFILE),
    };
  }
  const source = input as Partial<PersonalizationState>;
  return {
    version: 1,
    enabled: source.enabled === true,
    updatedAt:
      typeof source.updatedAt === "number" && Number.isFinite(source.updatedAt)
        ? source.updatedAt
        : 0,
    profile: normalizeProfile(source.profile),
  };
}

function defaultStorage(): PersonalProfileStorage {
  return chrome.storage as unknown as PersonalProfileStorage;
}

export async function loadPersonalizationState(
  storage: PersonalProfileStorage = defaultStorage(),
): Promise<PersonalizationState> {
  const stored = await storage.local.get(PERSONAL_PROFILE_STORAGE_KEY);
  return normalizeState(stored[PERSONAL_PROFILE_STORAGE_KEY]);
}

export async function savePersonalizationState(
  state: Pick<PersonalizationState, "enabled" | "profile">,
  storage: PersonalProfileStorage = defaultStorage(),
): Promise<PersonalizationState> {
  const next: PersonalizationState = {
    version: 1,
    enabled: state.enabled,
    updatedAt: Date.now(),
    profile: normalizeProfile(state.profile),
  };
  await storage.local.set({ [PERSONAL_PROFILE_STORAGE_KEY]: next });
  return next;
}

export async function deletePersonalProfile(
  storage: PersonalProfileStorage = defaultStorage(),
): Promise<PersonalizationState> {
  await storage.local.remove(PERSONAL_PROFILE_STORAGE_KEY);
  return {
    ...EMPTY_PERSONALIZATION_STATE,
    profile: cloneProfile(EMPTY_PERSONAL_PROFILE),
  };
}

function hasValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasValue);
  if (value && typeof value === "object") {
    return Object.values(value).some(hasValue);
  }
  return false;
}

export function hasUsablePersonalProfile(state: PersonalizationState): boolean {
  return hasValue(state.profile);
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  return trimmed.startsWith("profile.")
    ? trimmed.slice("profile.".length)
    : trimmed;
}

function getPathValue(profile: PersonalProfile, path: string): unknown {
  const normalized = normalizePath(path);
  if (normalized === "identity.full_name") {
    return [profile.identity.first_name, profile.identity.last_name]
      .filter(Boolean)
      .join(" ");
  }
  if (normalized === "name" || normalized === "full_name") {
    return getPathValue(profile, "identity.full_name");
  }
  if (normalized === "email") return profile.contact.email;
  if (normalized === "phone") return profile.contact.phone;
  if (normalized === "location") return profile.contact.location;

  let current: unknown = profile;
  for (const segment of normalized.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function isPresent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export async function resolveProfileFields(
  fields: string[],
  storage: PersonalProfileStorage = defaultStorage(),
): Promise<ProfileResolveResult> {
  const state = await loadPersonalizationState(storage);
  const requested = fields
    .filter((field): field is string => typeof field === "string")
    .map((field) => field.trim())
    .filter(Boolean);

  if (!state.enabled || !hasUsablePersonalProfile(state)) {
    return { values: {}, missing: requested, disabled: true };
  }

  const values: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const field of requested) {
    const value = getPathValue(state.profile, field);
    if (isPresent(value)) {
      values[field] = value;
    } else {
      missing.push(field);
    }
  }
  return { values, missing };
}

export function buildPersonalProfilePlannerContext(
  query: string,
  state: PersonalizationState,
): string {
  if (!state.enabled || !hasUsablePersonalProfile(state)) return "";
  if (!APPLICATION_TASK_PATTERN.test(query)) return "";
  return [
    "SAVED PROFILE:",
    "- A local saved profile is enabled for application and form tasks.",
    "- Do not infer exact values from this note. Call get_profile_fields for only the fields needed before typing saved profile data.",
    "- Final submission of job applications must remain user-approved.",
  ].join("\n");
}

function renderValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function formatProfileFieldsForToolResult(
  result: ProfileResolveResult,
): string {
  if (result.disabled) {
    return "Profile use is turned off or no saved profile exists. Ask the user to personalize the harness or turn on Use saved profile before using saved profile data.";
  }

  const lines = ["PROFILE FIELDS:"];
  for (const [field, value] of Object.entries(result.values)) {
    lines.push(`- ${field}: ${renderValue(value)}`);
  }
  if (Object.keys(result.values).length === 0) {
    lines.push("- No requested saved profile values were found.");
  }
  if (result.missing.length > 0) {
    lines.push("", `Missing: ${result.missing.join(", ")}`);
  }
  return lines.join("\n");
}
