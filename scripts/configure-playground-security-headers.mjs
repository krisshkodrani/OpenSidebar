#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const required = ["PLAYGROUND_CONTROL_DISTRIBUTION_ID", "PLAYGROUND_TARGET_DISTRIBUTION_ID"];
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required.`);
const dryRun = process.argv.includes("--dry-run");

function aws(args, inherit = false) {
  console.log(`$ aws ${args.join(" ")}`);
  if (dryRun) return "";
  return execFileSync("aws", args, { encoding: "utf8", stdio: inherit ? "inherit" : ["ignore", "pipe", "inherit"] });
}

function policyConfig(name, contentSecurityPolicy) {
  return {
    Name: name,
    Comment: "Security headers for the isolated OpenSidebar Playground surface",
    SecurityHeadersConfig: {
      XSSProtection: { Override: true, Protection: true, ModeBlock: true },
      FrameOptions: { Override: true, FrameOption: "DENY" },
      ReferrerPolicy: { Override: true, ReferrerPolicy: "no-referrer" },
      ContentSecurityPolicy: { Override: true, ContentSecurityPolicy: contentSecurityPolicy },
      ContentTypeOptions: { Override: true },
      StrictTransportSecurity: { Override: true, AccessControlMaxAgeSec: 31_536_000, IncludeSubdomains: true, Preload: false },
    },
    CustomHeadersConfig: {
      Quantity: 2,
      Items: [
        { Header: "Permissions-Policy", Value: "camera=(), microphone=(), geolocation=()", Override: true },
        { Header: "Cross-Origin-Opener-Policy", Value: "same-origin", Override: true },
      ],
    },
  };
}

function normalizePolicy(config) {
  return JSON.stringify(config);
}

function ensurePolicy(expected) {
  if (dryRun) { console.log(`Would ensure response headers policy ${expected.Name}`); return `${expected.Name}-ID`; }
  const listed = JSON.parse(aws(["cloudfront", "list-response-headers-policies", "--type", "custom", "--output", "json"]));
  const match = listed.ResponseHeadersPolicyList?.Items?.find((item) => item.ResponseHeadersPolicy.ResponseHeadersPolicyConfig.Name === expected.Name);
  if (!match) {
    return JSON.parse(aws(["cloudfront", "create-response-headers-policy", "--response-headers-policy-config", JSON.stringify(expected), "--output", "json"])).ResponseHeadersPolicy.Id;
  }
  const id = match.ResponseHeadersPolicy.Id;
  const current = JSON.parse(aws(["cloudfront", "get-response-headers-policy", "--id", id, "--output", "json"]));
  if (normalizePolicy(current.ResponseHeadersPolicy.ResponseHeadersPolicyConfig) !== normalizePolicy(expected)) {
    aws(["cloudfront", "update-response-headers-policy", "--id", id, "--if-match", current.ETag,
      "--response-headers-policy-config", JSON.stringify(expected)], true);
  }
  return id;
}

function updateDistribution(id, update) {
  if (dryRun) { console.log(`Would update security headers on ${id}`); return; }
  const document = JSON.parse(aws(["cloudfront", "get-distribution-config", "--id", id, "--output", "json"]));
  update(document.DistributionConfig);
  execFileSync("aws", ["cloudfront", "update-distribution", "--id", id, "--if-match", document.ETag,
    "--distribution-config", JSON.stringify(document.DistributionConfig)], { stdio: "inherit" });
}

const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const controlPolicy = ensurePolicy(policyConfig("OpenSidebarPlaygroundControlSecurity", csp));
const targetPolicy = ensurePolicy(policyConfig("OpenSidebarPlaygroundTargetSecurity", csp));

updateDistribution(process.env.PLAYGROUND_CONTROL_DISTRIBUTION_ID, (config) => {
  const paths = new Set(["/playground", "/playground/*"]);
  config.CacheBehaviors ??= { Quantity: 0, Items: [] };
  config.CacheBehaviors.Items ??= [];
  config.CacheBehaviors.Items = config.CacheBehaviors.Items.filter((item) => !paths.has(item.PathPattern));
  for (const PathPattern of paths) config.CacheBehaviors.Items.push({ ...config.DefaultCacheBehavior, PathPattern, ResponseHeadersPolicyId: controlPolicy });
  for (const behavior of config.CacheBehaviors.Items) {
    if (behavior.PathPattern === "/sandbox" || behavior.PathPattern === "/sandbox/index.html") behavior.ResponseHeadersPolicyId = controlPolicy;
  }
  config.CacheBehaviors.Quantity = config.CacheBehaviors.Items.length;
});

updateDistribution(process.env.PLAYGROUND_TARGET_DISTRIBUTION_ID, (config) => {
  config.DefaultCacheBehavior.ResponseHeadersPolicyId = targetPolicy;
});
