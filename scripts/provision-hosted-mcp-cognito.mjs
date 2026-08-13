#!/usr/bin/env node
/** Converge the separate public Cognito client and resource scopes for hosted MCP. */
import { execFileSync } from "node:child_process";

const apply = process.argv.includes("--apply");
const profile = process.env.AWS_PROFILE || "aipoweredapps-admin";
const region = process.env.AWS_REGION || "eu-central-1";
const poolName = process.env.PLAYGROUND_COGNITO_POOL_NAME || "OpenSidebar";
const clientName = process.env.OPENSIDEBAR_MCP_CLIENT_NAME || "OpenSidebarCodexMcp";
const resource = process.env.OPENSIDEBAR_MCP_RESOURCE || "https://opensidebar.com/mcp";
const callbackUrl = process.env.OPENSIDEBAR_MCP_CALLBACK_URL?.trim();
const scopeNames = [
  "browser.devices.read",
  "browser.tasks.create",
  "browser.tasks.read",
  "browser.tasks.continue",
  "browser.tasks.approve",
  "browser.tasks.cancel",
];

if (!callbackUrl)
  throw new Error(
    "Set OPENSIDEBAR_MCP_CALLBACK_URL to the exact fixed Codex OAuth callback URL.",
  );
const callback = new URL(callbackUrl);
if (
  callback.username ||
  callback.password ||
  callback.search ||
  callback.hash ||
  !(
    callback.protocol === "https:" ||
    (callback.protocol === "http:" && callback.hostname === "localhost")
  )
) throw new Error("OPENSIDEBAR_MCP_CALLBACK_URL must be HTTPS or http://localhost with no query or fragment");
if (new URL(resource).protocol !== "https:")
  throw new Error("OPENSIDEBAR_MCP_RESOURCE must use HTTPS");

function aws(args) {
  return execFileSync(
    "aws",
    [...args, "--profile", profile, "--region", region, "--no-cli-pager"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], timeout: 60_000 },
  ).trim();
}
function json(args) {
  const output = aws([...args, "--output", "json"]);
  return output ? JSON.parse(output) : null;
}
function mutate(args) {
  console.log(`$ aws ${args.join(" ")} --profile ${profile} --region ${region}`);
  return apply ? aws(args) : "";
}

console.log(`${apply ? "APPLY" : "DRY RUN"}: hosted MCP Cognito boundary in ${region}`);
if (!apply) {
  console.log(`Would converge resource ${resource}, six custom scopes, and public PKCE client ${clientName}.`);
  console.log(`Callback: ${callbackUrl}`);
  console.log("No AWS calls were made. Pass --apply to converge it.");
  process.exit(0);
}

const pools = json(["cognito-idp", "list-user-pools", "--max-results", "60"]).UserPools;
const pool = pools.find((candidate) => candidate.Name === poolName);
if (!pool?.Id) throw new Error(`Cognito pool ${poolName} was not found`);
const poolId = pool.Id;
const scopes = scopeNames.map((scopeName) => ({
  ScopeName: scopeName,
  ScopeDescription: `OpenSidebar hosted browser: ${scopeName}`,
}));
const resources = json([
  "cognito-idp",
  "list-resource-servers",
  "--user-pool-id",
  poolId,
  "--max-results",
  "50",
]).ResourceServers;
const existingResource = resources.find((candidate) => candidate.Identifier === resource);
mutate([
  "cognito-idp",
  existingResource ? "update-resource-server" : "create-resource-server",
  "--user-pool-id",
  poolId,
  "--identifier",
  resource,
  "--name",
  "OpenSidebar hosted browser MCP",
  "--scopes",
  JSON.stringify(scopes),
]);

const clients = json([
  "cognito-idp",
  "list-user-pool-clients",
  "--user-pool-id",
  poolId,
  "--max-results",
  "60",
]).UserPoolClients;
const existingClient = clients.find((candidate) => candidate.ClientName === clientName);
const command = [
  "cognito-idp",
  existingClient ? "update-user-pool-client" : "create-user-pool-client",
  "--user-pool-id",
  poolId,
  ...(existingClient ? ["--client-id", existingClient.ClientId] : ["--client-name", clientName, "--no-generate-secret"]),
  "--explicit-auth-flows",
  "ALLOW_REFRESH_TOKEN_AUTH",
  "--allowed-o-auth-flows",
  "code",
  "--allowed-o-auth-scopes",
  "openid",
  ...scopeNames.map((scope) => `${resource}/${scope}`),
  "--allowed-o-auth-flows-user-pool-client",
  "--supported-identity-providers",
  "COGNITO",
  "--callback-urls",
  callbackUrl,
  "--prevent-user-existence-errors",
  "ENABLED",
  "--auth-session-validity",
  "5",
  "--refresh-token-validity",
  "30",
  "--access-token-validity",
  "15",
  "--id-token-validity",
  "15",
  "--token-validity-units",
  "AccessToken=minutes,IdToken=minutes,RefreshToken=days",
];
const output = mutate(command);
const client = existingClient ?? JSON.parse(output).UserPoolClient;
const issuer = `https://cognito-idp.${region}.amazonaws.com/${poolId}`;

console.log("\nHosted MCP Cognito boundary converged; keep HOSTED_MCP_ENABLED=false until acceptance:");
console.log(`COGNITO_ISSUER=${issuer}`);
console.log(`COGNITO_MCP_CLIENT_ID=${client.ClientId}`);
console.log(`MCP_SCOPE_PREFIX=${resource}/`);
console.log(`MCP_RESOURCE=${resource}`);
console.log(`CODEX_MCP_OAUTH_CALLBACK_URL=${callbackUrl}`);
