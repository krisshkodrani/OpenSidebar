#!/usr/bin/env node
/**
 * One-command AWS setup for the opensidebar.com marketing site
 * (S3 private origin + CloudFront + ACM cert). Idempotent and two-phase —
 * a certificate needs DNS validation before a distribution can use it, so
 * this script runs twice with an owner DNS step in between.
 *
 *   PHASE A (first run): create bucket, request/lookup the ACM cert, then
 *   PRINT the DNS validation CNAME(s) to add at Namecheap and stop.
 *
 *   PHASE B (re-run once the cert shows ISSUED): create the Origin Access
 *   Control + CloudFront distribution, attach the bucket policy, then PRINT
 *   the final Namecheap records (apex ALIAS + www CNAME) and the deploy
 *   env values.
 *
 * AWS credentials come from the ambient CLI config; nothing is stored in the
 * repo. Certs for CloudFront MUST live in us-east-1 (enforced below).
 *
 *   node scripts/provision-site-infra.mjs [--bucket NAME] [--dry-run]
 *
 * Env: none required. Optional SITE_S3_BUCKET overrides the default bucket
 * name (opensidebar-site).
 */

import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const bucketArgIdx = args.indexOf("--bucket");
const BUCKET =
  (bucketArgIdx >= 0 && args[bucketArgIdx + 1]) ||
  process.env.SITE_S3_BUCKET ||
  "opensidebar-site";
const DOMAIN = "opensidebar.com";
const ALT = `www.${DOMAIN}`;
const CERT_REGION = "us-east-1"; // CloudFront requirement.

function aws(cmdArgs, { region, capture = true } = {}) {
  const full = region ? [...cmdArgs, "--region", region] : cmdArgs;
  if (DRY) {
    console.log("  [dry-run] aws " + full.join(" "));
    return "";
  }
  return execFileSync("aws", full, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
}

function tryAws(cmdArgs, opts) {
  try {
    return { ok: true, out: aws(cmdArgs, opts) };
  } catch (e) {
    return { ok: false, err: e };
  }
}

function heading(t) {
  console.log(`\n=== ${t} ===`);
}

// ---------- preflight ----------
try {
  execFileSync("aws", ["--version"], { stdio: "ignore" });
} catch {
  console.error("aws CLI not found on PATH. Install it and `aws configure` first.");
  process.exit(1);
}

// ---------- 1. S3 bucket (private) ----------
heading(`S3 bucket: ${BUCKET}`);
const head = tryAws(["s3api", "head-bucket", "--bucket", BUCKET]);
if (head.ok) {
  console.log("  exists — leaving as-is.");
} else {
  // us-east-1 buckets must NOT pass a LocationConstraint; others must.
  const region =
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  const createArgs = ["s3api", "create-bucket", "--bucket", BUCKET];
  if (region !== "us-east-1") {
    createArgs.push(
      "--create-bucket-configuration",
      `LocationConstraint=${region}`,
    );
  }
  aws(createArgs);
  aws([
    "s3api",
    "put-public-access-block",
    "--bucket",
    BUCKET,
    "--public-access-block-configuration",
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
  ]);
  console.log("  created (private, public access blocked).");
}

// ---------- 2. ACM certificate (us-east-1) ----------
heading(`ACM certificate for ${DOMAIN} + ${ALT} (${CERT_REGION})`);
let certArn = "";
const list = tryAws(
  ["acm", "list-certificates", "--query", "CertificateSummaryList", "--output", "json"],
  { region: CERT_REGION },
);
if (list.ok && list.out) {
  const found = JSON.parse(list.out).find((c) => c.DomainName === DOMAIN);
  if (found) certArn = found.CertificateArn;
}
if (!certArn) {
  const req = aws(
    [
      "acm",
      "request-certificate",
      "--domain-name",
      DOMAIN,
      "--subject-alternative-names",
      ALT,
      "--validation-method",
      "DNS",
      "--query",
      "CertificateArn",
      "--output",
      "text",
    ],
    { region: CERT_REGION },
  );
  certArn = (req || "").trim();
  console.log(`  requested: ${certArn || "(dry-run)"}`);
} else {
  console.log(`  found: ${certArn}`);
}

// Describe cert for status + validation records.
const desc = tryAws(
  ["acm", "describe-certificate", "--certificate-arn", certArn, "--output", "json"],
  { region: CERT_REGION },
);
let status = "PENDING_VALIDATION";
let validations = [];
if (desc.ok && desc.out) {
  const c = JSON.parse(desc.out).Certificate;
  status = c.Status;
  validations = (c.DomainValidationOptions || [])
    .filter((v) => v.ResourceRecord)
    .map((v) => v.ResourceRecord);
}

if (status !== "ISSUED") {
  heading("PHASE A — add these DNS records at Namecheap, then re-run this script");
  console.log(
    "  Namecheap → Domain List → opensidebar.com → Advanced DNS → Add New Record.",
  );
  console.log("  Type: CNAME Record   (TTL: Automatic)\n");
  const uniq = new Map(validations.map((r) => [r.Name, r]));
  for (const r of uniq.values()) {
    // Namecheap Host is the record name minus the trailing ".opensidebar.com."
    const host = r.Name.replace(/\.?opensidebar\.com\.?$/i, "").replace(/\.$/, "");
    console.log(`    Host:  ${host || "@"}`);
    console.log(`    Value: ${r.Value.replace(/\.$/, "")}`);
    console.log("");
  }
  console.log(
    `  Certificate status: ${status}. Re-run \`node scripts/provision-site-infra.mjs\` ` +
      "once ACM shows ISSUED (usually minutes after the CNAME propagates).",
  );
  process.exit(0);
}

// ---------- 3. Origin Access Control ----------
heading("CloudFront Origin Access Control");
let oacId = "";
const oacList = tryAws([
  "cloudfront",
  "list-origin-access-controls",
  "--query",
  "OriginAccessControlList.Items",
  "--output",
  "json",
]);
if (oacList.ok && oacList.out) {
  const items = JSON.parse(oacList.out) || [];
  const found = items.find((o) => o.Name === `${BUCKET}-oac`);
  if (found) oacId = found.Id;
}
if (!oacId) {
  const cfg = {
    Name: `${BUCKET}-oac`,
    Description: "OAC for opensidebar.com site bucket",
    SigningProtocol: "sigv4",
    SigningBehavior: "always",
    OriginAccessControlOriginType: "s3",
  };
  const out = aws([
    "cloudfront",
    "create-origin-access-control",
    "--origin-access-control-config",
    JSON.stringify(cfg),
    "--query",
    "OriginAccessControl.Id",
    "--output",
    "text",
  ]);
  oacId = (out || "").trim();
  console.log(`  created: ${oacId || "(dry-run)"}`);
} else {
  console.log(`  found: ${oacId}`);
}

// ---------- 4. CloudFront distribution ----------
heading("CloudFront distribution");
const originDomain = `${BUCKET}.s3.${
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1"
}.amazonaws.com`;
const callerRef = `opensidebar-site-${DOMAIN}`;
let distId = "";
let distDomain = "";
const distList = tryAws([
  "cloudfront",
  "list-distributions",
  "--query",
  "DistributionList.Items",
  "--output",
  "json",
]);
if (distList.ok && distList.out) {
  const items = JSON.parse(distList.out) || [];
  const found = items.find((d) =>
    (d.Aliases?.Items || []).includes(DOMAIN),
  );
  if (found) {
    distId = found.Id;
    distDomain = found.DomainName;
  }
}

if (!distId) {
  const distConfig = {
    CallerReference: callerRef,
    Aliases: { Quantity: 2, Items: [DOMAIN, ALT] },
    DefaultRootObject: "index.html",
    Origins: {
      Quantity: 1,
      Items: [
        {
          Id: "s3-origin",
          DomainName: originDomain,
          OriginAccessControlId: oacId,
          S3OriginConfig: { OriginAccessIdentity: "" },
        },
      ],
    },
    DefaultCacheBehavior: {
      TargetOriginId: "s3-origin",
      ViewerProtocolPolicy: "redirect-to-https",
      Compress: true,
      // AWS managed CachingOptimized policy.
      CachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6",
      AllowedMethods: {
        Quantity: 2,
        Items: ["GET", "HEAD"],
        CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] },
      },
    },
    CustomErrorResponses: {
      Quantity: 1,
      Items: [
        {
          ErrorCode: 403,
          ResponseCode: "200",
          ResponsePagePath: "/index.html",
          ErrorCachingMinTTL: 10,
        },
      ],
    },
    Comment: "opensidebar.com marketing site",
    Enabled: true,
    HttpVersion: "http2and3",
    ViewerCertificate: {
      ACMCertificateArn: certArn,
      SSLSupportMethod: "sni-only",
      MinimumProtocolVersion: "TLSv1.2_2021",
    },
    PriceClass: "PriceClass_100",
  };
  const out = aws([
    "cloudfront",
    "create-distribution",
    "--distribution-config",
    JSON.stringify(distConfig),
    "--query",
    "Distribution.{Id:Id,Domain:DomainName}",
    "--output",
    "json",
  ]);
  if (out) {
    const d = JSON.parse(out);
    distId = d.Id;
    distDomain = d.Domain;
  }
  console.log(`  created: ${distId || "(dry-run)"} → ${distDomain}`);
} else {
  console.log(`  found: ${distId} → ${distDomain}`);
}

// ---------- 5. Bucket policy granting the distribution OAC read ----------
heading("S3 bucket policy (allow this distribution via OAC)");
const acct =
  (tryAws(["sts", "get-caller-identity", "--query", "Account", "--output", "text"]).out || "")
    .trim() || "ACCOUNT_ID";
const policy = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "AllowCloudFrontServicePrincipalReadOnly",
      Effect: "Allow",
      Principal: { Service: "cloudfront.amazonaws.com" },
      Action: "s3:GetObject",
      Resource: `arn:aws:s3:::${BUCKET}/*`,
      Condition: {
        StringEquals: {
          "AWS:SourceArn": `arn:aws:cloudfront::${acct}:distribution/${distId || "DIST_ID"}`,
        },
      },
    },
  ],
};
aws(["s3api", "put-bucket-policy", "--bucket", BUCKET, "--policy", JSON.stringify(policy)]);
console.log("  applied.");

// ---------- final owner instructions ----------
heading("PHASE B — final DNS records at Namecheap");
console.log("  Namecheap → opensidebar.com → Advanced DNS:\n");
console.log("    1) Apex (opensidebar.com):");
console.log("       Namecheap free DNS has no ALIAS/ANAME at the apex. Two options:");
console.log(`       • Easiest: add an URL Redirect / or use Namecheap's "CNAME @" if offered → ${distDomain}`);
console.log("       • Robust: move the domain's nameservers to Route 53 and add an");
console.log(`         A/AAAA Alias record → ${distDomain} (Route 53 supports apex alias).`);
console.log("");
console.log("    2) www subdomain:");
console.log("       Type: CNAME Record");
console.log("       Host:  www");
console.log(`       Value: ${distDomain}`);
console.log("");
heading("Deploy env values");
console.log(`  SITE_S3_BUCKET=${BUCKET}`);
console.log(`  SITE_CLOUDFRONT_DISTRIBUTION_ID=${distId || "(see console)"}`);
console.log("  SITE_BASE_URL=https://opensidebar.com");
console.log("\n  Then: node scripts/deploy-site.mjs");
