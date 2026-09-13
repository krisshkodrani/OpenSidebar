import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { buildSync } from "esbuild";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

function repositoryRoot(start: string): string {
  let directory = start;
  while (!existsSync(path.join(directory, "pnpm-lock.yaml"))) {
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error("Could not find repository root for Sandbox Lambda bundling");
    directory = parent;
  }
  return directory;
}

function bundleApi(root: string): lambda.Code {
  return lambda.Code.fromAsset(root, {
    assetHashType: cdk.AssetHashType.OUTPUT,
    bundling: {
      image: lambda.Runtime.NODEJS_22_X.bundlingImage,
      local: { tryBundle(outputDirectory: string) {
        buildSync({ entryPoints: [path.join(root, "infra/sandbox/src/handler.ts")], outfile: path.join(outputDirectory, "index.js"), bundle: true, external: ["@aws-sdk/*"], format: "cjs", platform: "node", target: "node22", minify: true, legalComments: "none" });
        return true;
      } },
      command: ["bash", "-c", "echo 'Local esbuild is required for Sandbox synthesis' >&2; exit 1"],
    },
  });
}

/** Public Sandbox infrastructure. Domain names are supplied at deploy time so dev/stage may use separate hosts. */
export class SandboxStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const controlOrigin = this.node.tryGetContext("controlOrigin") ?? "https://opensidebar.com";
    const targetOrigin = this.node.tryGetContext("targetOrigin") ?? "https://play.opensidebar.com";
    const targetDomainName = this.node.tryGetContext("targetDomainName") ?? "play.opensidebar.com";
    const targetCertificateArn = this.node.tryGetContext("targetCertificateArn") as string | undefined;
    const root = repositoryRoot(path.dirname(fileURLToPath(import.meta.url)));

    const table = new dynamodb.Table(this, "Runs", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: "ttl",
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const authQuotaSecret = new secretsmanager.Secret(this, "AuthQuotaKey", { generateSecretString: { passwordLength: 64, excludePunctuation: true } });
    const pool = new cognito.UserPool(this, "Users", {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: false } },
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      // The Control Center only presents email OTP. Cognito still requires the
      // password factor to remain enabled in this policy, but no password UI or
      // password grant is exposed by this client.
      signInPolicy: { allowedFirstAuthFactors: { password: true, emailOtp: true } },
      passwordPolicy: { minLength: 32, requireDigits: true, requireLowercase: true, requireUppercase: true, requireSymbols: true, tempPasswordValidity: cdk.Duration.days(1) },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const client = pool.addClient("ControlCenter", { authFlows: { userSrp: false, userPassword: false, custom: false, user: true }, oAuth: { flows: { authorizationCodeGrant: true }, callbackUrls: [`${controlOrigin}/api/v1/playground/auth/callback`, `${controlOrigin}/api/sandbox/auth/callback`], logoutUrls: [`${controlOrigin}/playground`, `${controlOrigin}/sandbox`], scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL] }, refreshTokenValidity: cdk.Duration.days(90), accessTokenValidity: cdk.Duration.hours(1), preventUserExistenceErrors: true, generateSecret: false });
    const domainPrefix = this.node.tryGetContext("cognitoDomainPrefix") ?? `opensidebar-sandbox-${this.account}`;
    const hostedUi = pool.addDomain("HostedUi", { cognitoDomain: { domainPrefix } });

    const apiLogs = new logs.LogGroup(this, "ApiLogs", { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.RETAIN });
    const apiHandler = new lambda.Function(this, "ApiHandler", {
      runtime: lambda.Runtime.NODEJS_22_X,
      code: bundleApi(root), handler: "index.handler", timeout: cdk.Duration.seconds(10), memorySize: 512,
      // This account has the default concurrency quota of ten. Reserving all
      // ten would make CloudFormation reject the function because AWS keeps a
      // minimum unreserved pool; rely on the account quota until it is raised.
      logGroup: apiLogs,
      environment: { SANDBOX_TABLE_NAME: table.tableName, CONTROL_ORIGIN: controlOrigin, TARGET_ORIGIN: targetOrigin, COGNITO_DOMAIN: hostedUi.baseUrl(), COGNITO_CLIENT_ID: client.userPoolClientId, AUTH_QUOTA_HMAC_KEY: authQuotaSecret.secretValue.unsafeUnwrap() },
    });
    table.grantReadWriteData(apiHandler);
    apiHandler.addToRolePolicy(new iam.PolicyStatement({ actions: ["cognito-idp:GetUser", "cognito-idp:SignUp", "cognito-idp:ConfirmSignUp", "cognito-idp:InitiateAuth", "cognito-idp:RespondToAuthChallenge", "cognito-idp:ResendConfirmationCode"], resources: [pool.userPoolArn] }));
    const api = new apigwv2.HttpApi(this, "Api", { corsPreflight: { allowHeaders: ["authorization", "content-type"], allowMethods: [apigwv2.CorsHttpMethod.ANY], allowOrigins: [controlOrigin], allowCredentials: true } });
    const integration = new integrations.HttpLambdaIntegration("SandboxIntegration", apiHandler);
    const authorizer = new authorizers.HttpUserPoolAuthorizer("ControlAuthorizer", pool, { userPoolClients: [client] });
    api.addRoutes({ path: "/v1/sandbox/{proxy+}", methods: [apigwv2.HttpMethod.ANY], integration, authorizer });
    api.addRoutes({ path: "/api/sandbox/{proxy+}", methods: [apigwv2.HttpMethod.ANY], integration });
    // Target routes do not use the Control Center JWT; the target host-only cookie is checked by the handler.
    api.addRoutes({ path: "/v1/sandbox/target/{proxy+}", methods: [apigwv2.HttpMethod.ANY], integration });
    api.addRoutes({ path: "/api/sandbox/target/{proxy+}", methods: [apigwv2.HttpMethod.ANY], integration });
    api.addRoutes({ path: "/api/sandbox/auth/{proxy+}", methods: [apigwv2.HttpMethod.ANY], integration });
    api.addRoutes({ path: "/launch/{launchToken}", methods: [apigwv2.HttpMethod.GET], integration });

    const targetBucket = new s3.Bucket(this, "TargetSite", { blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, encryption: s3.BucketEncryption.S3_MANAGED, enforceSSL: true, removalPolicy: cdk.RemovalPolicy.RETAIN, autoDeleteObjects: false });
    const targetSpaRewrite = new cloudfront.Function(this, "TargetSpaRewrite", {
      code: cloudfront.FunctionCode.fromInline("function handler(event) { var request = event.request; if (request.uri.indexOf('/run/') === 0) request.uri = '/index.html'; return request; }"),
    });
    const targetDistribution = new cloudfront.Distribution(this, "TargetDistribution", {
      ...(targetCertificateArn ? { domainNames: [targetDomainName], certificate: acm.Certificate.fromCertificateArn(this, "TargetCertificate", targetCertificateArn) } : {}),
      defaultRootObject: "index.html",
      // Only static SPA routes are rewritten. Exact API and launch behaviors
      // retain their own origins and status codes.
      defaultBehavior: { origin: origins.S3BucketOrigin.withOriginAccessControl(targetBucket), viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS, allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS, cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED, functionAssociations: [{ eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: targetSpaRewrite }] },
      additionalBehaviors: {
        "/api/sandbox/target/*": { origin: new origins.HttpOrigin(cdk.Fn.parseDomainName(api.apiEndpoint)), viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY, allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL, cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER },
        "/launch/*": { origin: new origins.HttpOrigin(cdk.Fn.parseDomainName(api.apiEndpoint)), viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY, allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS, cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER },
      },
    });
    new cdk.CfnOutput(this, "ApiEndpoint", { value: api.apiEndpoint });
    new cdk.CfnOutput(this, "CognitoUserPoolId", { value: pool.userPoolId });
    new cdk.CfnOutput(this, "CognitoClientId", { value: client.userPoolClientId });
    new cdk.CfnOutput(this, "TargetBucketName", { value: targetBucket.bucketName });
    new cdk.CfnOutput(this, "TargetDistributionDomain", { value: targetDistribution.distributionDomainName });
  }
}
