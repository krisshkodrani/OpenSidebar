declare module "@aws-sdk/client-dynamodb" {
  export class DynamoDBClient { constructor(config?: unknown); }
}
declare module "@aws-sdk/client-cognito-identity-provider" {
  export class CognitoIdentityProviderClient { constructor(config?: unknown); send(command: unknown): Promise<any>; }
  export class GetUserCommand { constructor(input: any); }
  export class SignUpCommand { constructor(input: any); }
  export class ConfirmSignUpCommand { constructor(input: any); }
  export class InitiateAuthCommand { constructor(input: any); }
  export class RespondToAuthChallengeCommand { constructor(input: any); }
  export class ResendConfirmationCodeCommand { constructor(input: any); }
}
declare module "@aws-sdk/lib-dynamodb" {
  export class DynamoDBDocumentClient { static from(client: unknown): DynamoDBDocumentClient; send(command: unknown): Promise<any>; }
  export class GetCommand { constructor(input: any); }
  export class PutCommand { constructor(input: any); }
  export class UpdateCommand { constructor(input: any); }
}
declare module "esbuild" {
  export function buildSync(options: unknown): void;
}
