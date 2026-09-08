#!/usr/bin/env node
/** Converge the dedicated LP-28 credential KMS key and least-privilege Lightsail IAM user. */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const apply = process.argv.includes("--apply"),
  createAccessKey = process.argv.includes("--create-access-key");
const outputIndex = process.argv.indexOf("--access-key-output"),
  outputArgument = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
const profile = process.env.AWS_PROFILE || "aipoweredapps-admin",
  region = process.env.AWS_REGION || "eu-central-1";
const aliasName =
    process.env.OPENSIDEBAR_CREDENTIAL_KMS_ALIAS ||
    "alias/opensidebar-credentials",
  userName =
    process.env.OPENSIDEBAR_KMS_IAM_USER || "opensidebar-lightsail-kms";
if (createAccessKey && !apply)
  throw new Error("--create-access-key requires --apply");
if (createAccessKey && !outputArgument)
  throw new Error(
    "--create-access-key requires --access-key-output <absolute-path>",
  );
const outputPath = outputArgument ? resolve(outputArgument) : undefined;
if (outputArgument && !isAbsolute(outputArgument))
  throw new Error("--access-key-output must be absolute");
if (outputPath && existsSync(outputPath))
  throw new Error(`Refusing to overwrite ${outputPath}`);
const aws = (args) =>
  execFileSync(
    "aws",
    [...args, "--profile", profile, "--region", region, "--no-cli-pager"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], timeout: 60_000 },
  ).trim();
const json = (args) => {
  const value = aws([...args, "--output", "json"]);
  return value ? JSON.parse(value) : null;
};
console.log(
  `${apply ? "APPLY" : "DRY RUN"}: ${aliasName} and ${userName} in ${region}`,
);
if (!apply) {
  console.log(
    "Would create/locate a rotating symmetric KMS key and a dedicated IAM user limited to DescribeKey, GenerateDataKey, and Decrypt on that key.",
  );
  console.log(
    "No access key is created unless --apply --create-access-key --access-key-output <absolute-path> is supplied.",
  );
  process.exit(0);
}
let alias = json(["kms", "list-aliases", "--limit", "100"]).Aliases.find(
  (item) => item.AliasName === aliasName,
);
let keyId = alias?.TargetKeyId;
if (!keyId) {
  const created = json([
    "kms",
    "create-key",
    "--description",
    "OpenSidebar provider credential envelope key",
    "--key-usage",
    "ENCRYPT_DECRYPT",
    "--key-spec",
    "SYMMETRIC_DEFAULT",
    "--tags",
    "TagKey=project,TagValue=opensidebar",
    "TagKey=purpose,TagValue=provider-credentials",
  ]);
  keyId = created.KeyMetadata.KeyId;
  aws(["kms", "enable-key-rotation", "--key-id", keyId]);
  aws([
    "kms",
    "create-alias",
    "--alias-name",
    aliasName,
    "--target-key-id",
    keyId,
  ]);
}
const key = json(["kms", "describe-key", "--key-id", keyId]).KeyMetadata;
try {
  json(["iam", "get-user", "--user-name", userName]);
} catch {
  aws([
    "iam",
    "create-user",
    "--user-name",
    userName,
    "--tags",
    "Key=project,Value=opensidebar",
    "Key=purpose,Value=lightsail-kms",
  ]);
}
const policy = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "OpenSidebarCredentialEnvelopeOnly",
      Effect: "Allow",
      Action: ["kms:DescribeKey", "kms:GenerateDataKey", "kms:Decrypt"],
      Resource: key.Arn,
    },
  ],
};
aws([
  "iam",
  "put-user-policy",
  "--user-name",
  userName,
  "--policy-name",
  "OpenSidebarCredentialEnvelopeOnly",
  "--policy-document",
  JSON.stringify(policy),
]);
console.log(`CREDENTIAL_KMS_KEY_ID=${aliasName}`);
console.log(`KMS_KEY_ARN=${key.Arn}`);
console.log(`IAM_USER=${userName}`);
if (createAccessKey && outputPath) {
  const access = json([
    "iam",
    "create-access-key",
    "--user-name",
    userName,
  ]).AccessKey;
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        AccessKeyId: access.AccessKeyId,
        SecretAccessKey: access.SecretAccessKey,
      },
      null,
      2,
    ) + "\n",
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  chmodSync(outputPath, 0o600);
  console.log(
    `Wrote the one-time access key response to ${outputPath}; move its values into the root-only Lightsail environment, then securely remove the file.`,
  );
}
