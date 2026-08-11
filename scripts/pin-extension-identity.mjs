#!/usr/bin/env node
/** Pin the Chrome Web Store public key after verifying its derived extension ID. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const expected = (process.env.OPENSIDEBAR_EXTENSION_ID ?? "").trim(),
  publicKey = (process.env.OPENSIDEBAR_EXTENSION_PUBLIC_KEY ?? "").replace(
    /\s/g,
    "",
  );
if (!/^[a-p]{32}$/.test(expected))
  throw new Error(
    "Set OPENSIDEBAR_EXTENSION_ID to the published 32-character Chrome extension ID",
  );
if (!/^[A-Za-z0-9+/]+={0,2}$/.test(publicKey))
  throw new Error(
    "Set OPENSIDEBAR_EXTENSION_PUBLIC_KEY to the developer-dashboard base64 DER public key; a downloaded CRX is Google-signed and cannot supply it",
  );
const digest = createHash("sha256")
  .update(Buffer.from(publicKey, "base64"))
  .digest("hex")
  .slice(0, 32);
const derived = [...digest]
  .map((value) => String.fromCharCode(97 + Number.parseInt(value, 16)))
  .join("");
if (derived !== expected)
  throw new Error(
    `Public key derives extension ID ${derived}, not ${expected}; refusing to pin a mismatched identity`,
  );
const manifestPath = resolve("apps/extension/manifest.json"),
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.key = publicKey;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`Pinned and verified OpenSidebar extension identity ${derived}`);
