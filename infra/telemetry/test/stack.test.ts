import assert from "node:assert/strict";
import test from "node:test";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { FleetTelemetryStack } from "../lib/fleet-telemetry-stack.ts";

function synthesize(): Template {
  const app = new cdk.App();
  const stack = new FleetTelemetryStack(app, "TestFleetTelemetry", {
    env: { account: "123456789012", region: "eu-central-1" },
  });
  return Template.fromStack(stack);
}

test("synthesizes a private, retained, lifecycle-bound telemetry store", () => {
  const template = synthesize();

  template.hasResourceProperties("AWS::S3::Bucket", {
    BucketEncryption: {
      ServerSideEncryptionConfiguration: Match.arrayWith([
        Match.objectLike({
          ServerSideEncryptionByDefault: Match.objectLike({
            SSEAlgorithm: "aws:kms",
          }),
        }),
      ]),
    },
    LifecycleConfiguration: {
      Rules: Match.arrayWith([
        Match.objectLike({
          ExpirationInDays: 30,
          NoncurrentVersionExpiration: { NoncurrentDays: 7 },
          Status: "Enabled",
        }),
      ]),
    },
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
    VersioningConfiguration: { Status: "Enabled" },
  });

  const buckets = template.findResources("AWS::S3::Bucket");
  const bucket = Object.values(buckets)[0] as {
    DeletionPolicy?: string;
    UpdateReplacePolicy?: string;
  };
  assert.equal(bucket.DeletionPolicy, "Retain");
  assert.equal(bucket.UpdateReplacePolicy, "Retain");

  const serialized = JSON.stringify(template.toJSON());
  assert.match(serialized, /logs\.eu-central-1\./);
  assert.match(serialized, /kms:EncryptionContext:aws:logs:arn/);
});

test("bundles the reviewed TypeScript validator and grants Firehose required S3 access", () => {
  const template = synthesize();

  template.hasResourceProperties("AWS::Lambda::Function", {
    Handler: "index.handler",
    MemorySize: 256,
    ReservedConcurrentExecutions: 5,
    Runtime: "nodejs22.x",
    Timeout: 5,
  });

  const policies = template.findResources("AWS::IAM::Policy");
  const actions = Object.values(policies).flatMap((policy) => {
    const statements = (
      policy as {
        Properties: {
          PolicyDocument: {
            Statement: Array<{ Action?: string | string[] }>;
          };
        };
      }
    ).Properties.PolicyDocument.Statement;
    return statements.flatMap(({ Action = [] }) =>
      Array.isArray(Action) ? Action : [Action],
    );
  });

  for (const action of [
    "s3:AbortMultipartUpload",
    "s3:GetBucketLocation",
    "s3:GetObject",
    "s3:ListBucket",
    "s3:ListBucketMultipartUploads",
    "s3:PutObject",
  ]) {
    assert.ok(actions.includes(action), `missing Firehose permission ${action}`);
  }
  assert.equal(actions.includes("s3:DeleteObject"), false);
});

test("sets the account-wide monthly budget alarm at USD 40", () => {
  const template = synthesize();

  template.hasResourceProperties("AWS::Budgets::Budget", {
    Budget: {
      BudgetLimit: { Amount: 40, Unit: "USD" },
      BudgetName: "opensidebar-telemetry-beta",
      BudgetType: "COST",
      TimeUnit: "MONTHLY",
    },
  });
});

test("allows anonymous browser-extension telemetry posts through CORS", () => {
  const template = synthesize();

  template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
    CorsConfiguration: {
      AllowHeaders: ["content-type"],
      AllowMethods: ["POST"],
      AllowOrigins: ["*"],
    },
  });
});
