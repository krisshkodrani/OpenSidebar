import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const region = process.env.AWS_REGION ?? "eu-central-1";
const accountSuffix = process.env.AWS_ACCOUNT_ID?.trim();
const bucket =
  process.env.TRACE_BUCKET_NAME?.trim() ??
  (accountSuffix
    ? `opensidebar-traces-${accountSuffix}-${region}`
    : `opensidebar-traces-${randomBytes(4).toString("hex")}-${region}`);

const aws = (...args) => {
  const result = spawnSync("aws", [...args, "--region", region], {
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0)
    throw new Error(`AWS CLI command failed: aws ${args.join(" ")}`);
};

const createArgs = ["s3api", "create-bucket", "--bucket", bucket];
if (region !== "us-east-1")
  createArgs.push(
    "--create-bucket-configuration",
    `LocationConstraint=${region}`,
  );
aws(...createArgs);
aws(
  "s3api",
  "put-public-access-block",
  "--bucket",
  bucket,
  "--public-access-block-configuration",
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
);
aws(
  "s3api",
  "put-bucket-ownership-controls",
  "--bucket",
  bucket,
  "--ownership-controls",
  "Rules=[{ObjectOwnership=BucketOwnerEnforced}]",
);
aws(
  "s3api",
  "put-bucket-versioning",
  "--bucket",
  bucket,
  "--versioning-configuration",
  "Status=Enabled",
);
aws(
  "s3api",
  "put-bucket-encryption",
  "--bucket",
  bucket,
  "--server-side-encryption-configuration",
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}',
);
aws(
  "s3api",
  "put-bucket-lifecycle-configuration",
  "--bucket",
  bucket,
  "--lifecycle-configuration",
  '{"Rules":[{"ID":"encrypted-trace-defense-in-depth-expiry","Status":"Enabled","Filter":{"Prefix":"v1/accounts/"},"Expiration":{"Days":35},"NoncurrentVersionExpiration":{"NoncurrentDays":7},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}',
);

console.log(`TRACE_BUCKET_NAME=${bucket}`);
console.log(
  "Bucket created private, versioned, encrypted, and lifecycle bounded.",
);
console.log(
  "Grant the service identity only s3:GetObject, PutObject, DeleteObject on:",
);
console.log(`arn:aws:s3:::${bucket}/v1/accounts/*`);
