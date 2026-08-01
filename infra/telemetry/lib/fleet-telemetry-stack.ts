import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as athena from "aws-cdk-lib/aws-athena";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as firehose from "aws-cdk-lib/aws-kinesisfirehose";
import * as glue from "aws-cdk-lib/aws-glue";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { buildSync } from "esbuild";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

function findRepositoryRoot(start: string): string {
  let directory = start;
  while (true) {
    if (existsSync(path.join(directory, "pnpm-lock.yaml"))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error("Could not find repository root for telemetry Lambda bundling");
    }
    directory = parent;
  }
}

function bundleValidator(repositoryRoot: string): lambda.Code {
  return lambda.Code.fromAsset(repositoryRoot, {
    assetHashType: cdk.AssetHashType.OUTPUT,
    bundling: {
      image: lambda.Runtime.NODEJS_22_X.bundlingImage,
      local: {
        tryBundle(outputDirectory: string): boolean {
          buildSync({
            entryPoints: [
              path.join(repositoryRoot, "infra/telemetry/src/handler.ts"),
            ],
            outfile: path.join(outputDirectory, "index.js"),
            bundle: true,
            format: "cjs",
            legalComments: "none",
            logLevel: "warning",
            minify: true,
            platform: "node",
            sourcemap: false,
            target: "node22",
          });
          return true;
        },
      },
      command: [
        "bash",
        "-c",
        "echo 'Local esbuild is required for telemetry synthesis' >&2; exit 1",
      ],
    },
  });
}

export class FleetTelemetryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const repositoryRoot = findRepositoryRoot(
      path.dirname(fileURLToPath(import.meta.url)),
    );
    const key = new kms.Key(this, "TelemetryKey", {
      enableKeyRotation: true,
      description: "KMS key for OpenSidebar fleet telemetry objects",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    key.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowCloudWatchLogsUse",
        actions: [
          "kms:Decrypt",
          "kms:Describe*",
          "kms:Encrypt",
          "kms:GenerateDataKey*",
          "kms:ReEncrypt*",
        ],
        principals: [
          new iam.ServicePrincipal(`logs.${this.region}.${this.urlSuffix}`),
        ],
        resources: ["*"],
        conditions: {
          ArnLike: {
            "kms:EncryptionContext:aws:logs:arn":
              `arn:${this.partition}:logs:${this.region}:${this.account}:log-group:*`,
          },
        },
      }),
    );
    const bucket = new s3.Bucket(this, "RawTelemetryBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: key,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(30), noncurrentVersionExpiration: cdk.Duration.days(7) }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    const deliveryRole = new iam.Role(this, "FirehoseRole", {
      assumedBy: new iam.ServicePrincipal("firehose.amazonaws.com"),
    });
    deliveryRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "s3:GetBucketLocation",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
        ],
        resources: [bucket.bucketArn],
      }),
    );
    deliveryRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "s3:AbortMultipartUpload",
          "s3:GetObject",
          "s3:PutObject",
        ],
        resources: [bucket.arnForObjects("*")],
      }),
    );
    key.grantEncryptDecrypt(deliveryRole);

    const stream = new firehose.CfnDeliveryStream(this, "TelemetryStream", {
      deliveryStreamType: "DirectPut",
      extendedS3DestinationConfiguration: {
        bucketArn: bucket.bucketArn,
        roleArn: deliveryRole.roleArn,
        prefix: "schemaVersion=1/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/",
        errorOutputPrefix: "errors/!{firehose:error-output-type}/",
        bufferingHints: { intervalInSeconds: 60, sizeInMBs: 1 },
        compressionFormat: "GZIP",
        encryptionConfiguration: { kmsEncryptionConfig: { awskmsKeyArn: key.keyArn } },
      },
    });

    const database = new glue.CfnDatabase(this, "TelemetryDatabase", {
      catalogId: this.account,
      databaseInput: {
        name: "opensidebar_fleet_telemetry",
        description: "Validated OpenSidebar fleet summaries; no raw traces.",
      },
    });
    const table = new glue.CfnTable(this, "TelemetryTable", {
      catalogId: this.account,
      databaseName: database.ref,
      tableInput: {
        name: "fleet_telemetry_v1",
        tableType: "EXTERNAL_TABLE",
        parameters: { classification: "json", typeOfData: "file" },
        storageDescriptor: {
          location: bucket.s3UrlForObject("schemaVersion=1/"),
          inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
          outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
          serdeInfo: {
            serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
          },
          columns: [
            { name: "schemaversion", type: "int" },
            { name: "eventid", type: "string" },
            { name: "extension", type: "struct<version:string,channel:string>" },
            { name: "environment", type: "struct<browsermajor:int,osfamily:string>" },
            { name: "runtime", type: "struct<provider:string,executormodel:string,plannermodel:string,judgemodel:string,taskshape:string>" },
            { name: "execution", type: "struct<plannerstepcount:int,turncount:int,durationbucket:string,toolcounts:map<string,struct<attempted:int,failed:int>>>" },
            { name: "completion", type: "struct<donecallcount:int,firstdonecandidateturn:int,accepteddoneturn:int,acceptedsource:string,rejecteddonecount:int,rejectionreasons:array<string>,evidencetypes:array<string>,firstsatisfiedevidenceturn:int,turnsafterfirstsatisfiedevidence:int>" },
            { name: "result", type: "struct<outcome:string,terminalreason:string,errorcodes:array<string>>" },
          ],
        },
      },
    });
    table.addDependency(database);
    new athena.CfnWorkGroup(this, "TelemetryAthenaWorkGroup", {
      name: "opensidebar-fleet-telemetry",
      state: "ENABLED",
      workGroupConfiguration: {
        enforceWorkGroupConfiguration: true,
        bytesScannedCutoffPerQuery: 100 * 1024 * 1024,
        resultConfiguration: {
          outputLocation: bucket.s3UrlForObject("athena-results/"),
          encryptionConfiguration: { encryptionOption: "SSE_KMS", kmsKey: key.keyArn },
        },
      },
    });

    const handlerLogGroup = new logs.LogGroup(this, "ValidatorLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      encryptionKey: key,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const validator = new lambda.Function(this, "Validator", {
      runtime: lambda.Runtime.NODEJS_22_X,
      code: bundleValidator(repositoryRoot),
      handler: "index.handler",
      timeout: cdk.Duration.seconds(5),
      memorySize: 256,
      reservedConcurrentExecutions: 5,
      logGroup: handlerLogGroup,
      environment: { DELIVERY_STREAM_NAME: stream.ref },
    });
    validator.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["firehose:PutRecord"],
        resources: [stream.attrArn],
      }),
    );

    const api = new apigwv2.HttpApi(this, "TelemetryApi", {
      createDefaultStage: false,
      corsPreflight: {
        allowHeaders: ["content-type"],
        allowMethods: [apigwv2.CorsHttpMethod.POST],
        allowOrigins: ["*"],
      },
    });
    const integration = new integrations.HttpLambdaIntegration("ValidatorIntegration", validator);
    api.addRoutes({ path: "/v1/telemetry", methods: [apigwv2.HttpMethod.POST], integration });
    const stage = new apigwv2.CfnStage(this, "TelemetryStage", {
      apiId: api.httpApiId,
      stageName: "$default",
      autoDeploy: true,
      defaultRouteSettings: { throttlingBurstLimit: 50, throttlingRateLimit: 25 },
    });

    new cloudwatch.Alarm(this, "ValidatorErrors", {
      metric: validator.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const budgetEmail = process.env.BUDGET_EMAIL;
    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetLimit: { amount: 40, unit: "USD" },
        budgetName: "opensidebar-telemetry-beta",
        budgetType: "COST",
        timeUnit: "MONTHLY",
      },
      ...(budgetEmail
        ? {
            notificationsWithSubscribers: [
              {
                notification: { comparisonOperator: "GREATER_THAN", notificationType: "ACTUAL", threshold: 80, thresholdType: "PERCENTAGE" },
                subscribers: [{ address: budgetEmail, subscriptionType: "EMAIL" }],
              },
              {
                notification: { comparisonOperator: "GREATER_THAN", notificationType: "FORECASTED", threshold: 100, thresholdType: "PERCENTAGE" },
                subscribers: [{ address: budgetEmail, subscriptionType: "EMAIL" }],
              },
            ],
          }
        : {}),
    });

    // Explicitly name the future query surface without adding an optional
    // dashboard or Bluebox export in Phase 3.
    new cdk.CfnOutput(this, "IngestEndpoint", { value: `${api.apiEndpoint}/v1/telemetry` });
    new cdk.CfnOutput(this, "RawBucketName", { value: bucket.bucketName });
    new cdk.CfnOutput(this, "DeliveryStreamName", { value: stream.ref });
    new cdk.CfnOutput(this, "Region", { value: this.region });
  }
}
