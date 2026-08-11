import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

export class ControlPlaneStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const credentialKey = new kms.Key(this, "CredentialKey", {
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
      description: "Envelope encryption key for OpenSidebar provider credentials",
    });
    const credentials = new dynamodb.Table(this, "Credentials", {
      partitionKey: { name: "accountId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "provider", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: credentialKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const preferences = new dynamodb.Table(this, "Preferences", {
      partitionKey: { name: "accountId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const usage = new dynamodb.Table(this, "Usage", {
      partitionKey: { name: "accountPeriod", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const client = userPool.addClient("ExtensionPublicClient", {
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: ["https://placeholder.chromiumapp.org/oauth2"],
        logoutUrls: ["https://placeholder.chromiumapp.org/logout"],
      },
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      refreshTokenValidity: Duration.days(30),
      accessTokenValidity: Duration.minutes(15),
      idTokenValidity: Duration.minutes(15),
    });
    userPool.addDomain("ManagedLoginDomain", {
      cognitoDomain: { domainPrefix: `opensidebar-${this.account}-${this.region}` },
    });

    const handlerEnvironment = {
      CREDENTIALS_TABLE: credentials.tableName,
      PREFERENCES_TABLE: preferences.tableName,
      USAGE_TABLE: usage.tableName,
      CREDENTIAL_KMS_KEY_ID: credentialKey.keyId,
    };
    const control = this.nodeFunction("ControlHandler", "control.ts", handlerEnvironment, 30);
    const relay = this.nodeFunction("RelayHandler", "relay.ts", handlerEnvironment, 900);
    relay.addEnvironment("MAX_CONCURRENT_STREAMS", "3");
    relay.addEnvironment("MAX_MONTHLY_REQUESTS", "10000");
    relay.addEnvironment("MAX_MONTHLY_TOKENS", "50000000");
    relay.addEnvironment("AWS_NODEJS_CONNECTION_REUSE_ENABLED", "1");

    credentials.grantReadWriteData(control);
    preferences.grantReadWriteData(control);
    credentialKey.grantEncrypt(control);
    credentials.grantReadData(relay);
    usage.grantReadWriteData(relay);
    credentialKey.grantDecrypt(relay);

    const api = new apigateway.RestApi(this, "Api", {
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      deployOptions: {
        stageName: "v1",
        throttlingBurstLimit: 50,
        throttlingRateLimit: 25,
        loggingLevel: apigateway.MethodLoggingLevel.OFF,
        dataTraceEnabled: false,
        metricsEnabled: true,
      },
      cloudWatchRole: false,
    });
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "Authorizer", {
      cognitoUserPools: [userPool],
    });
    const authenticated = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };
    const controlIntegration = new apigateway.LambdaIntegration(control);
    for (const route of ["account", "preferences", "credentials", "usage", "devices"]) {
      api.root.addResource(route).addMethod("ANY", controlIntegration, authenticated);
    }
    const relayResource = api.root.addResource("relay").addResource("responses");
    relayResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(relay, {
        responseTransferMode: apigateway.ResponseTransferMode.STREAM,
        timeout: Duration.minutes(15),
      }),
      authenticated,
    );

    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: { budgetType: "COST", timeUnit: "MONTHLY", budgetLimit: { amount: 100, unit: "USD" } },
    });

    // Keep these reachable in the synthesized template and deployment outputs.
    void client;
  }

  private nodeFunction(
    id: string,
    entryName: string,
    environment: Record<string, string>,
    timeoutSeconds: number,
  ): nodejs.NodejsFunction {
    return new nodejs.NodejsFunction(this, id, {
      entry: path.join(path.dirname(fileURLToPath(import.meta.url)), `../src/${entryName}`),
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "handler",
      timeout: Duration.seconds(timeoutSeconds),
      memorySize: entryName === "relay.ts" ? 1024 : 512,
      reservedConcurrentExecutions: entryName === "relay.ts" ? 50 : 25,
      environment,
      logGroup: new logs.LogGroup(this, `${id}Logs`, {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      bundling: { sourceMap: false, minify: true },
    });
  }
}
