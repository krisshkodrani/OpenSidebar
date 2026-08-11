import { createHash, createHmac, randomBytes } from "node:crypto";

export const opaqueToken = (bytes = 32) =>
  randomBytes(bytes).toString("base64url");
export const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
export const keyedHash = (key: string, value: string) =>
  createHmac("sha256", key).update(value).digest("base64url");
