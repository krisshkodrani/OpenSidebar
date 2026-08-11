#!/usr/bin/env node
/** Attach allowlisted dynamic paths to the private Lightsail/Caddy origin. */
import { execFileSync } from "node:child_process";

const required = ["PLAYGROUND_CONTROL_DISTRIBUTION_ID", "PLAYGROUND_TARGET_DISTRIBUTION_ID", "LIGHTSAIL_API_ORIGIN"];
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required.`);
const dryRun = process.argv.includes("--dry-run");
const cutover = process.argv.includes("--cutover");
const endpoint = new URL(process.env.LIGHTSAIL_API_ORIGIN);
if (endpoint.protocol !== "https:") throw new Error("LIGHTSAIL_API_ORIGIN must use HTTPS.");
const originId = "opensidebar-lightsail-api";
const cachePolicyId = process.env.API_CACHE_POLICY_ID ?? "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"; // AWS managed CachingDisabled.

function aws(args) {
  console.log(`$ aws ${args.join(" ")}`);
  if (dryRun) return "";
  return execFileSync("aws", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}
function behavior(pathPattern, policyId) {
  return {
    PathPattern: pathPattern, TargetOriginId: originId, ViewerProtocolPolicy: "https-only",
    SmoothStreaming: false, TrustedSigners: { Enabled: false, Quantity: 0 },
    TrustedKeyGroups: { Enabled: false, Quantity: 0 }, LambdaFunctionAssociations: { Quantity: 0 },
    FunctionAssociations: { Quantity: 0 }, FieldLevelEncryptionId: "", GrpcConfig: { Enabled: false },
    AllowedMethods: { Quantity: 7, Items: ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"], CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] } },
    Compress: true, CachePolicyId: cachePolicyId, OriginRequestPolicyId: policyId,
  };
}

function policyConfig(name, cookies, headers, queryStringBehavior) {
  return {
    Name: name,
    Comment: "Least-privilege forwarding to the OpenSidebar Lightsail Playground origin",
    CookiesConfig: { CookieBehavior: "whitelist", Cookies: { Quantity: cookies.length, Items: cookies } },
    HeadersConfig: { HeaderBehavior: "whitelist", Headers: { Quantity: headers.length, Items: headers } },
    QueryStringsConfig: { QueryStringBehavior: queryStringBehavior },
  };
}
function policyMatches(actual, expected) {
  const normalize = (items = []) => [...items].map((item) => item.toLowerCase()).sort();
  const same = (left, right) => JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
  return !(actual.CookiesConfig.CookieBehavior !== "whitelist" || !same(actual.CookiesConfig.Cookies?.Items, expected.CookiesConfig.Cookies.Items) ||
      actual.HeadersConfig.HeaderBehavior !== "whitelist" || !same(actual.HeadersConfig.Headers?.Items, expected.HeadersConfig.Headers.Items) ||
      actual.QueryStringsConfig.QueryStringBehavior !== expected.QueryStringsConfig.QueryStringBehavior);
}
function ensurePolicy(envName, expected) {
  if (dryRun) { console.log(`Would ensure origin request policy ${expected.Name}`); return process.env[envName] ?? `${expected.Name}-ID`; }
  let id = process.env[envName];
  if (!id) {
    const list = JSON.parse(aws(["cloudfront", "list-origin-request-policies", "--type", "custom", "--output", "json"]));
    id = list.OriginRequestPolicyList?.Items?.find((item) => item.OriginRequestPolicy.OriginRequestPolicyConfig.Name === expected.Name)?.OriginRequestPolicy.Id;
  }
  if (!id) {
    const created = JSON.parse(aws(["cloudfront", "create-origin-request-policy", "--origin-request-policy-config", JSON.stringify(expected), "--output", "json"]));
    id = created.OriginRequestPolicy.Id;
  }
  const current = JSON.parse(aws(["cloudfront", "get-origin-request-policy", "--id", id, "--output", "json"]));
  if (!policyMatches(current.OriginRequestPolicy.OriginRequestPolicyConfig, expected)) {
    aws(["cloudfront", "update-origin-request-policy", "--id", id, "--if-match", current.ETag,
      "--origin-request-policy-config", JSON.stringify(expected)]);
    const updated = JSON.parse(aws(["cloudfront", "get-origin-request-policy", "--id", id, "--output", "json"]));
    if (!policyMatches(updated.OriginRequestPolicy.OriginRequestPolicyConfig, expected)) throw new Error(`Origin request policy ${expected.Name} did not converge.`);
  }
  return id;
}
function updateDistribution(distributionId, paths, policyId) {
  if (dryRun) { console.log(`Would attach ${paths.join(", ")} to ${distributionId}`); return; }
  const document = JSON.parse(aws(["cloudfront", "get-distribution-config", "--id", distributionId, "--output", "json"]));
  const config = document.DistributionConfig;
  config.Origins.Items ??= [];
  config.Origins.Items = config.Origins.Items.filter((origin) => origin.Id !== originId);
  config.Origins.Items.push({ Id: originId, DomainName: endpoint.hostname, OriginPath: "", CustomHeaders: { Quantity: 0 },
    CustomOriginConfig: { HTTPPort: 80, HTTPSPort: 443, OriginProtocolPolicy: "https-only", OriginReadTimeout: 30,
      OriginKeepaliveTimeout: 5, OriginSslProtocols: { Quantity: 1, Items: ["TLSv1.2"] } } });
  config.Origins.Quantity = config.Origins.Items.length;
  config.CacheBehaviors ??= { Quantity: 0, Items: [] }; config.CacheBehaviors.Items ??= [];
  if (cutover) {
    const legacy = new Set(["/api/sandbox/*", "/api/sandbox/target/*"]);
    config.CacheBehaviors.Items = config.CacheBehaviors.Items.filter((item) => !legacy.has(item.PathPattern));
  }
  config.CacheBehaviors.Items = config.CacheBehaviors.Items.filter((item) => !paths.includes(item.PathPattern));
  config.CacheBehaviors.Items.push(...paths.map((path) => behavior(path, policyId)));
  config.CacheBehaviors.Quantity = config.CacheBehaviors.Items.length;
  if (config.CustomErrorResponses?.Items) {
    config.CustomErrorResponses.Items = config.CustomErrorResponses.Items.filter((entry) => ![401, 403].includes(entry.ErrorCode));
    config.CustomErrorResponses.Quantity = config.CustomErrorResponses.Items.length;
  }
  execFileSync("aws", ["cloudfront", "update-distribution", "--id", distributionId, "--if-match", document.ETag,
    "--distribution-config", JSON.stringify(config)], { stdio: "inherit" });
}

const controlPolicy = ensurePolicy("CONTROL_API_ORIGIN_REQUEST_POLICY_ID", policyConfig(
  "OpenSidebarPlaygroundControlToLightsail",
  ["__Host-os_session", "os_csrf"],
  ["Accept", "Authorization", "Content-Type", "Idempotency-Key", "If-Match", "Origin", "X-Os-Csrf"],
  "all",
));
const targetPolicy = ensurePolicy("TARGET_API_ORIGIN_REQUEST_POLICY_ID", policyConfig(
  "OpenSidebarPlaygroundTargetToLightsail",
  ["__Host-os_playground_target"],
  ["Accept", "Content-Type", "Origin"],
  "none",
));
updateDistribution(process.env.PLAYGROUND_CONTROL_DISTRIBUTION_ID, ["/api/v1/*"], controlPolicy);
updateDistribution(process.env.PLAYGROUND_TARGET_DISTRIBUTION_ID, ["/api/v1/target/*", "/launch/*"], targetPolicy);
