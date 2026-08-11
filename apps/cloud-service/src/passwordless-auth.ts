import {
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  GetUserCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  RespondToAuthChallengeCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";

export type EmailChallenge = {
  mode: "signup" | "signin";
  providerSession?: string;
  accountId?: string;
};
export type PasswordlessIdentity = { accountId: string; email: string };

export interface PasswordlessAuthProvider {
  requestCode(email: string): Promise<EmailChallenge>;
  verifyCode(
    email: string,
    code: string,
    challenge: EmailChallenge,
  ): Promise<PasswordlessIdentity>;
}

export class CognitoPasswordlessAuthProvider implements PasswordlessAuthProvider {
  readonly client: CognitoIdentityProviderClient;
  constructor(
    region: string,
    private readonly clientId: string,
  ) {
    this.client = new CognitoIdentityProviderClient({ region });
  }

  async requestCode(email: string): Promise<EmailChallenge> {
    try {
      const signup = await this.client.send(
        new SignUpCommand({
          ClientId: this.clientId,
          Username: email,
          UserAttributes: [{ Name: "email", Value: email }],
        }),
      );
      if (!signup.UserSub)
        throw new Error("Cognito did not return a durable user identifier.");
      return {
        mode: "signup",
        providerSession: signup.Session,
        accountId: signup.UserSub,
      };
    } catch (cause) {
      if (!(cause instanceof Error) || cause.name !== "UsernameExistsException")
        throw cause;
    }

    try {
      const auth = await this.client.send(
        new InitiateAuthCommand({
          AuthFlow: "USER_AUTH",
          ClientId: this.clientId,
          AuthParameters: { USERNAME: email, PREFERRED_CHALLENGE: "EMAIL_OTP" },
        }),
      );
      if (auth.ChallengeName !== "EMAIL_OTP" || !auth.Session)
        throw new Error("Cognito did not issue an email challenge.");
      return { mode: "signin", providerSession: auth.Session };
    } catch (cause) {
      if (
        !(cause instanceof Error) ||
        cause.name !== "UserNotConfirmedException"
      )
        throw cause;
      await this.client.send(
        new ResendConfirmationCodeCommand({
          ClientId: this.clientId,
          Username: email,
        }),
      );
      return { mode: "signup" };
    }
  }

  private async identity(accessToken: string): Promise<PasswordlessIdentity> {
    const user = await this.client.send(
      new GetUserCommand({ AccessToken: accessToken }),
    );
    const attributes = Object.fromEntries(
      (user.UserAttributes ?? []).flatMap((item) =>
        item.Name && item.Value ? [[item.Name, item.Value]] : [],
      ),
    );
    if (!attributes.sub || !attributes.email)
      throw new Error("Cognito identity is incomplete.");
    return { accountId: attributes.sub, email: attributes.email.toLowerCase() };
  }

  async verifyCode(
    email: string,
    code: string,
    challenge: EmailChallenge,
  ): Promise<PasswordlessIdentity> {
    if (challenge.mode === "signup") {
      const confirmed = await this.client.send(
        new ConfirmSignUpCommand({
          ClientId: this.clientId,
          Username: email,
          ConfirmationCode: code,
          Session: challenge.providerSession,
        }),
      );
      if (confirmed.Session) {
        const authenticated = await this.client.send(
          new InitiateAuthCommand({
            AuthFlow: "USER_AUTH",
            ClientId: this.clientId,
            Session: confirmed.Session,
          }),
        );
        if (authenticated.AuthenticationResult?.AccessToken)
          return this.identity(authenticated.AuthenticationResult.AccessToken);
      }
      if (challenge.accountId) return { accountId: challenge.accountId, email };
      throw new Error("Cognito did not return a durable user identifier.");
    }
    if (!challenge.providerSession)
      throw new Error("Cognito challenge session is missing.");
    const auth = await this.client.send(
      new RespondToAuthChallengeCommand({
        ClientId: this.clientId,
        ChallengeName: "EMAIL_OTP",
        Session: challenge.providerSession,
        ChallengeResponses: { USERNAME: email, EMAIL_OTP_CODE: code },
      }),
    );
    if (!auth.AuthenticationResult?.AccessToken)
      throw new Error("Cognito did not complete the email challenge.");
    return this.identity(auth.AuthenticationResult.AccessToken);
  }
}
