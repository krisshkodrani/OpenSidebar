import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";

const DEFAULT_PROFILE_PATH = join(
  homedir(),
  ".opensidebar",
  "profiles",
  "default.yaml",
);

export interface ProfileFixtureData {
  profile: Record<string, unknown>;
}

export interface SeededProfile {
  profilePath: string;
  restore(): Promise<void>;
}

function getProfilePath(): string {
  return resolve(process.env.OPENSIDEBAR_PROFILE_PATH || DEFAULT_PROFILE_PATH);
}

export async function seedTemporaryProfile(
  data: ProfileFixtureData,
): Promise<SeededProfile> {
  const profilePath = getProfilePath();
  const directory = dirname(profilePath);
  await mkdir(directory, { recursive: true });

  let originalContent: string | null = null;
  try {
    originalContent = await readFile(profilePath, "utf-8");
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }

  await writeFile(profilePath, stringify(data), "utf-8");

  return {
    profilePath,
    async restore() {
      if (originalContent !== null) {
        await writeFile(profilePath, originalContent, "utf-8");
        return;
      }

      await rm(profilePath, { force: true });
    },
  };
}
