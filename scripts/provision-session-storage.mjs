#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const apply = process.argv.includes("--apply");
const profile = process.env.AWS_PROFILE || "aipoweredapps-admin";
const region = process.env.AWS_REGION || "eu-central-1";
const accountId = process.env.AWS_ACCOUNT_ID?.trim();
const aliasName =
  process.env.OPENSIDEBAR_SESSION_KMS_ALIAS || "alias/opensidebar-sessions";
const userName =
  process.env.OPENSIDEBAR_KMS_IAM_USER || "opensidebar-lightsail-kms";
const bucket =
  process.env.SESSION_BUCKET_NAME?.trim() ||
  (accountId ? `opensidebar-sessions-${accountId}-${region}` : "");
if (!/^\d{12}$/.test(accountId ?? ""))
  throw new Error("Set AWS_ACCOUNT_ID to the active 12-digit AWS account.");
if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
  throw new Error("SESSION_BUCKET_NAME is not a valid private bucket name.");

const aws = (args, output = "text") =>
  execFileSync(
    "aws",
    [...args, "--profile", profile, "--region", region, "--no-cli-pager", "--output", output],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], timeout: 60_000 },
  ).trim();
const json = (args) => {
  const value = aws(args, "json");
  return value ? JSON.parse(value) : null;
};

console.log(`${apply ? "APPLY" : "DRY RUN"}: ${aliasName}, ${bucket}, ${userName}`);
if (!apply) {
  console.log("Would create an isolated rotating session KMS key and a private, versioned, lifecycle-bounded session bucket.");
  console.log("Would grant the existing Lightsail service identity only envelope-key and session-prefix object access.");
  process.exit(0);
}

let alias = json(["kms", "list-aliases", "--limit", "100"]).Aliases.find(
  (item) => item.AliasName === aliasName,
);
let keyId = alias?.TargetKeyId;
if (!keyId) {
  const created = json([
    "kms", "create-key",
    "--description", "OpenSidebar session, checkpoint, and remote-mission envelope key",
    "--key-usage", "ENCRYPT_DECRYPT",
    "--key-spec", "SYMMETRIC_DEFAULT",
    "--tags", "TagKey=project,TagValue=opensidebar", "TagKey=purpose,TagValue=session-payloads",
  ]);
  keyId = created.KeyMetadata.KeyId;
  aws(["kms", "enable-key-rotation", "--key-id", keyId]);
  aws(["kms", "create-alias", "--alias-name", aliasName, "--target-key-id", keyId]);
}
const key = json(["kms", "describe-key", "--key-id", keyId]).KeyMetadata;

let bucketExists = true;
try {
  aws(["s3api", "head-bucket", "--bucket", bucket]);
} catch {
  bucketExists = false;
}
if (!bucketExists) {
  const create = ["s3api", "create-bucket", "--bucket", bucket];
  if (region !== "us-east-1")
    create.push("--create-bucket-configuration", `LocationConstraint=${region}`);
  aws(create);
}
aws([
  "s3api", "put-public-access-block", "--bucket", bucket,
  "--public-access-block-configuration",
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
]);
aws([
  "s3api", "put-bucket-ownership-controls", "--bucket", bucket,
  "--ownership-controls", "Rules=[{ObjectOwnership=BucketOwnerEnforced}]",
]);
aws([
  "s3api", "put-bucket-versioning", "--bucket", bucket,
  "--versioning-configuration", "Status=Enabled",
]);
aws([
  "s3api", "put-bucket-encryption", "--bucket", bucket,
  "--server-side-encryption-configuration",
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}',
]);
aws([
  "s3api", "put-bucket-lifecycle-configuration", "--bucket", bucket,
  "--lifecycle-configuration",
  '{"Rules":[{"ID":"encrypted-session-defense-in-depth-expiry","Status":"Enabled","Filter":{"Prefix":"v1/accounts/"},"Expiration":{"Days":35},"NoncurrentVersionExpiration":{"NoncurrentDays":7},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}',
]);

const policy = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "OpenSidebarSessionEnvelopeOnly",
      Effect: "Allow",
      Action: ["kms:DescribeKey", "kms:GenerateDataKey", "kms:Decrypt"],
      Resource: key.Arn,
    },
    {
      Sid: "OpenSidebarSessionBucketMetadata",
      Effect: "Allow",
      Action: ["s3:GetBucketLocation", "s3:ListBucketVersions"],
      Resource: `arn:aws:s3:::${bucket}`,
      Condition: { StringLike: { "s3:prefix": ["v1/accounts/*"] } },
    },
    {
      Sid: "OpenSidebarSessionCiphertextOnly",
      Effect: "Allow",
      Action: [
        "s3:GetObject", "s3:PutObject", "s3:DeleteObject",
        "s3:GetObjectVersion", "s3:DeleteObjectVersion",
      ],
      Resource: `arn:aws:s3:::${bucket}/v1/accounts/*`,
    },
  ],
};
aws([
  "iam", "put-user-policy",
  "--user-name", userName,
  "--policy-name", "OpenSidebarSessionCiphertextOnly",
  "--policy-document", JSON.stringify(policy),
]);

console.log(`SESSION_KMS_KEY_ID=${aliasName}`);
console.log(`SESSION_BUCKET_NAME=${bucket}`);
console.log("Session storage is private, versioned, encrypted, lifecycle bounded, and isolated from provider credentials.");
