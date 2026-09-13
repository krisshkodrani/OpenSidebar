#!/usr/bin/env node
/**
 * Attach the authenticated Sandbox API behavior to the existing apex
 * opensidebar.com distribution. This intentionally lives outside the static
 * marketing provisioning script: an API must never inherit its SPA-style
 * error fallback or cache policy.
 *
 * Required env:
 *   SANDBOX_CONTROL_DISTRIBUTION_ID
 *   SANDBOX_API_ENDPOINT                 e.g. https://abc.execute-api.eu-central-1.amazonaws.com
 *   SANDBOX_API_CACHE_POLICY_ID           a CacheDisabled policy
 *   SANDBOX_API_ORIGIN_REQUEST_POLICY_ID  forwards only required cookies/headers
 */
import { execFileSync } from "node:child_process";

const required = ["SANDBOX_CONTROL_DISTRIBUTION_ID", "SANDBOX_API_ENDPOINT", "SANDBOX_API_CACHE_POLICY_ID", "SANDBOX_API_ORIGIN_REQUEST_POLICY_ID"];
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required.`);
const dryRun = process.argv.includes("--dry-run");
const distributionId = process.env.SANDBOX_CONTROL_DISTRIBUTION_ID;
const endpoint = new URL(process.env.SANDBOX_API_ENDPOINT);
const originId = "opensidebar-sandbox-api";
const sandboxHtmlPolicy = process.env.SANDBOX_CONTROL_CACHE_POLICY_ID ?? "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";

function aws(args) {
  console.log(`$ aws ${args.join(" ")}`);
  if (dryRun) return "";
  return execFileSync("aws", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}
const raw = aws(["cloudfront", "get-distribution-config", "--id", distributionId, "--output", "json"]);
if (dryRun) process.exit(0);
const document = JSON.parse(raw);
const config = document.DistributionConfig;
config.Origins ??= { Quantity: 0, Items: [] };
config.Origins.Items ??= [];
if (!config.Origins.Items.some((origin) => origin.Id === originId)) {
  config.Origins.Items.push({
    Id: originId,
    DomainName: endpoint.hostname,
    OriginPath: endpoint.pathname === "/" ? "" : endpoint.pathname,
    CustomHeaders: { Quantity: 0 },
    // CloudFront requires this explicitly when updating distributions whose
    // existing S3 origin configuration already includes an OriginReadTimeout.
    CustomOriginConfig: { HTTPPort: 80, HTTPSPort: 443, OriginProtocolPolicy: "https-only", OriginReadTimeout: 30, OriginKeepaliveTimeout: 5, OriginSslProtocols: { Quantity: 1, Items: ["TLSv1.2"] } },
  });
  config.Origins.Quantity = config.Origins.Items.length;
}
config.CacheBehaviors ??= { Quantity: 0, Items: [] };
config.CacheBehaviors.Items ??= [];
config.CacheBehaviors.Items = config.CacheBehaviors.Items.filter((behavior) => behavior.PathPattern !== "/api/sandbox/*");
config.CacheBehaviors.Items.push({
  PathPattern: "/api/sandbox/*",
  TargetOriginId: originId,
  ViewerProtocolPolicy: "https-only",
  SmoothStreaming: false,
  TrustedSigners: { Enabled: false, Quantity: 0 },
  TrustedKeyGroups: { Enabled: false, Quantity: 0 },
  LambdaFunctionAssociations: { Quantity: 0 },
  FunctionAssociations: { Quantity: 0 },
  FieldLevelEncryptionId: "",
  GrpcConfig: { Enabled: false },
  AllowedMethods: { Quantity: 7, Items: ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"], CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] } },
  Compress: true,
  CachePolicyId: process.env.SANDBOX_API_CACHE_POLICY_ID,
  OriginRequestPolicyId: process.env.SANDBOX_API_ORIGIN_REQUEST_POLICY_ID,
});
// The Control Center is a static S3 object on the existing origin. Give its
// HTML an explicit no-cache behavior while letting hashed /sandbox/assets/*
// continue to use the site's normal immutable/default asset policy.
const controlOriginId = config.DefaultCacheBehavior.TargetOriginId;
config.CacheBehaviors.Items = config.CacheBehaviors.Items.filter((behavior) => !["/sandbox", "/sandbox/index.html"].includes(behavior.PathPattern));
for (const pathPattern of ["/sandbox", "/sandbox/index.html"]) {
  config.CacheBehaviors.Items.push({
    PathPattern: pathPattern,
    TargetOriginId: controlOriginId,
    ViewerProtocolPolicy: "redirect-to-https",
    SmoothStreaming: false,
    TrustedSigners: { Enabled: false, Quantity: 0 },
    TrustedKeyGroups: { Enabled: false, Quantity: 0 },
    LambdaFunctionAssociations: { Quantity: 0 },
    FunctionAssociations: { Quantity: 0 },
    FieldLevelEncryptionId: "",
    GrpcConfig: { Enabled: false },
    AllowedMethods: { Quantity: 2, Items: ["GET", "HEAD"], CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] } },
    Compress: true,
    CachePolicyId: sandboxHtmlPolicy,
  });
}
config.CacheBehaviors.Quantity = config.CacheBehaviors.Items.length;

// CloudFront custom errors apply globally. Leaving the marketing site's 403
// rewrite in place would turn an API 401/403 into an HTML 200 response. Exact
// static paths are deployed by the site script, so remove this unsafe fallback.
if (config.CustomErrorResponses?.Items) {
  config.CustomErrorResponses.Items = config.CustomErrorResponses.Items.filter((entry) => entry.ErrorCode !== 403);
  config.CustomErrorResponses.Quantity = config.CustomErrorResponses.Items.length;
}

const input = JSON.stringify(config);
console.log("$ aws cloudfront update-distribution --id … --if-match … --distribution-config <config>");
execFileSync("aws", ["cloudfront", "update-distribution", "--id", distributionId, "--if-match", document.ETag, "--distribution-config", input], { stdio: "inherit" });
