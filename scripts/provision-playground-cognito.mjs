#!/usr/bin/env node
/** Cognito-only identity boundary for the OpenSidebar website and Playground. */
import { execFileSync } from "node:child_process";

const apply = process.argv.includes("--apply");
const profile = process.env.AWS_PROFILE || "aipoweredapps-admin";
const region = process.env.AWS_REGION || "eu-central-1";
const poolName = process.env.PLAYGROUND_COGNITO_POOL_NAME || "OpenSidebar";
const clientName =
  process.env.PLAYGROUND_COGNITO_CLIENT_NAME || "OpenSidebarWeb";
const extensionClientName =
  process.env.OPENSIDEBAR_COGNITO_EXTENSION_CLIENT_NAME ||
  "OpenSidebarExtension";
const extensionId = process.env.OPENSIDEBAR_EXTENSION_ID?.trim();
if (extensionId && !/^[a-p]{32}$/.test(extensionId))
  throw new Error(
    "OPENSIDEBAR_EXTENSION_ID must be the pinned 32-character Chrome extension ID",
  );

function aws(args) {
  return execFileSync(
    "aws",
    [...args, "--profile", profile, "--region", region, "--no-cli-pager"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      timeout: 60_000,
    },
  ).trim();
}
function json(args) {
  const output = aws([...args, "--output", "json"]);
  return output ? JSON.parse(output) : null;
}
function tryJson(args) {
  try {
    return json(args);
  } catch {
    return null;
  }
}
function mutation(args) {
  console.log(
    `$ aws ${args.join(" ")} --profile ${profile} --region ${region}`,
  );
  return apply ? aws(args) : "";
}

console.log(
  `${apply ? "APPLY" : "DRY RUN"}: Cognito ${poolName}/${clientName} in ${region}`,
);
if (!apply) {
  console.log(
    `Would ensure an Essentials email-OTP pool, public web PKCE client${extensionId ? ", public extension PKCE client" : ""}, managed-login domain, and default branding.`,
  );
  console.log("No AWS calls were made. Pass --apply to converge it.");
  process.exit(0);
}

const identity = json(["sts", "get-caller-identity"]);
let pool = json([
  "cognito-idp",
  "list-user-pools",
  "--max-results",
  "60",
]).UserPools.find((candidate) => candidate.Name === poolName);
if (!pool) {
  const policies = {
    PasswordPolicy: {
      MinimumLength: 32,
      RequireUppercase: true,
      RequireLowercase: true,
      RequireNumbers: true,
      RequireSymbols: true,
      TemporaryPasswordValidityDays: 1,
    },
    // Cognito currently requires PASSWORD to remain enabled when EMAIL_OTP is
    // selected. The public client exposes choice-based USER_AUTH; Playground
    // copy continues to lead with email OTP.
    SignInPolicy: { AllowedFirstAuthFactors: ["PASSWORD", "EMAIL_OTP"] },
  };
  const recovery = {
    RecoveryMechanisms: [{ Priority: 1, Name: "verified_email" }],
  };
  const output = mutation([
    "cognito-idp",
    "create-user-pool",
    "--pool-name",
    poolName,
    "--username-attributes",
    "email",
    "--auto-verified-attributes",
    "email",
    "--policies",
    JSON.stringify(policies),
    "--account-recovery-setting",
    JSON.stringify(recovery),
    "--mfa-configuration",
    "OFF",
    "--user-pool-tier",
    "ESSENTIALS",
    "--deletion-protection",
    "ACTIVE",
    "--user-pool-tags",
    JSON.stringify({ project: "opensidebar", environment: "testing" }),
  ]);
  pool = JSON.parse(output).UserPool;
}
const poolId = pool.Id;

let client = json([
  "cognito-idp",
  "list-user-pool-clients",
  "--user-pool-id",
  poolId,
  "--max-results",
  "60",
]).UserPoolClients.find((candidate) => candidate.ClientName === clientName);
if (!client) {
  const output = mutation([
    "cognito-idp",
    "create-user-pool-client",
    "--user-pool-id",
    poolId,
    "--client-name",
    clientName,
    "--no-generate-secret",
    "--explicit-auth-flows",
    "ALLOW_USER_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "--allowed-o-auth-flows",
    "code",
    "--allowed-o-auth-scopes",
    "openid",
    "email",
    "--allowed-o-auth-flows-user-pool-client",
    "--supported-identity-providers",
    "COGNITO",
    "--callback-urls",
    "https://opensidebar.com/api/v1/playground/auth/callback",
    "https://opensidebar.com/api/sandbox/auth/callback",
    "--logout-urls",
    "https://opensidebar.com/playground",
    "https://opensidebar.com/sandbox",
    "--prevent-user-existence-errors",
    "ENABLED",
    "--auth-session-validity",
    "5",
    "--refresh-token-validity",
    "90",
    "--access-token-validity",
    "60",
    "--id-token-validity",
    "60",
    "--token-validity-units",
    "AccessToken=minutes,IdToken=minutes,RefreshToken=days",
  ]);
  client = JSON.parse(output).UserPoolClient;
}
const clientId = client.ClientId;
let extensionClient = extensionId
  ? json([
      "cognito-idp",
      "list-user-pool-clients",
      "--user-pool-id",
      poolId,
      "--max-results",
      "60",
    ]).UserPoolClients.find(
      (candidate) => candidate.ClientName === extensionClientName,
    )
  : null;
if (extensionId && !extensionClient) {
  const output = mutation([
    "cognito-idp",
    "create-user-pool-client",
    "--user-pool-id",
    poolId,
    "--client-name",
    extensionClientName,
    "--no-generate-secret",
    "--explicit-auth-flows",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "--allowed-o-auth-flows",
    "code",
    "--allowed-o-auth-scopes",
    "openid",
    "email",
    "--allowed-o-auth-flows-user-pool-client",
    "--supported-identity-providers",
    "COGNITO",
    "--callback-urls",
    `https://${extensionId}.chromiumapp.org/opensidebar`,
    "--prevent-user-existence-errors",
    "ENABLED",
    "--auth-session-validity",
    "5",
    "--refresh-token-validity",
    "1",
    "--access-token-validity",
    "15",
    "--id-token-validity",
    "15",
    "--token-validity-units",
    "AccessToken=minutes,IdToken=minutes,RefreshToken=days",
  ]);
  extensionClient = JSON.parse(output).UserPoolClient;
}
const domainPrefix =
  process.env.PLAYGROUND_COGNITO_DOMAIN_PREFIX ||
  `opensidebar-playground-${identity.Account}`;
const domain = json([
  "cognito-idp",
  "describe-user-pool-domain",
  "--domain",
  domainPrefix,
]).DomainDescription;
if (!domain?.UserPoolId) {
  mutation([
    "cognito-idp",
    "create-user-pool-domain",
    "--domain",
    domainPrefix,
    "--user-pool-id",
    poolId,
    "--managed-login-version",
    "2",
  ]);
}
const branding = tryJson([
  "cognito-idp",
  "describe-managed-login-branding-by-client",
  "--user-pool-id",
  poolId,
  "--client-id",
  clientId,
]);
if (!branding?.ManagedLoginBranding) {
  mutation([
    "cognito-idp",
    "create-managed-login-branding",
    "--user-pool-id",
    poolId,
    "--client-id",
    clientId,
    "--use-cognito-provided-values",
  ]);
}
if (extensionClient) {
  const extensionBranding = tryJson([
    "cognito-idp",
    "describe-managed-login-branding-by-client",
    "--user-pool-id",
    poolId,
    "--client-id",
    extensionClient.ClientId,
  ]);
  if (!extensionBranding?.ManagedLoginBranding)
    mutation([
      "cognito-idp",
      "create-managed-login-branding",
      "--user-pool-id",
      poolId,
      "--client-id",
      extensionClient.ClientId,
      "--use-cognito-provided-values",
    ]);
}

console.log("\nCognito identity boundary converged:");
console.log(
  `COGNITO_DOMAIN=https://${domainPrefix}.auth.${region}.amazoncognito.com`,
);
console.log(`COGNITO_CLIENT_ID=${clientId}`);
console.log(`COGNITO_USER_POOL_ID=${poolId}`);
if (extensionClient)
  console.log(`COGNITO_EXTENSION_CLIENT_ID=${extensionClient.ClientId}`);
else
  console.log(
    "Set OPENSIDEBAR_EXTENSION_ID after creating the unpublished Chrome Web Store draft to provision the extension PKCE client.",
  );
