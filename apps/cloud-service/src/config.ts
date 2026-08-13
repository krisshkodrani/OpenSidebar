export type CloudConfig = {
  port: number;
  databaseUrl: string;
  controlOrigin: string;
  targetOrigin: string;
  cookieSecure: boolean;
  developmentAccountId?: string;
  cognitoDomain?: string;
  cognitoIssuer?: string;
  cognitoClientId?: string;
  awsRegion: string;
  authQuotaHmacKey: string;
  controlDatabaseUrl: string;
  cloudControlEnabled: boolean;
  extensionAuthEnabled: boolean;
  credentialWritesEnabled: boolean;
  relayEnabled: boolean;
  preferenceWritesEnabled: boolean;
  cloudSessionsEnabled: boolean;
  checkpointWritesEnabled: boolean;
  checkpointRestoreEnabled: boolean;
  sessionExportsEnabled?: boolean;
  deviceCommandsEnabled: boolean;
  deviceTakeoverEnabled: boolean;
  remoteMissionsEnabled?: boolean;
  hostedMcpEnabled?: boolean;
  cognitoMcpClientId?: string;
  mcpScopePrefix?: string;
  temporalShadowEnabled: boolean;
  temporalCoordinationEnabled: boolean;
  temporalShadowToken?: string;
  temporalShadowHashKey?: string;
  extensionClientId?: string;
  extensionId?: string;
  extensionTestIds?: ReadonlySet<string>;
  credentialKmsKeyId?: string;
  sessionKmsKeyId?: string;
  sessionBucketName?: string;
  traceSyncEnabled?: boolean;
  traceUploadsEnabled?: boolean;
  traceDownloadsEnabled?: boolean;
  traceBucketName?: string;
  traceTesterSubjects?: ReadonlySet<string>;
  cloudTesterSubjects: ReadonlySet<string>;
  cloudSessionTesterSubjects: ReadonlySet<string>;
  cloudOperatorSubjects: ReadonlySet<string>;
  relayModelAllowlist: ReadonlySet<string>;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CloudConfig {
  const required = (name: string) => {
    const value = env[name];
    if (!value)
      throw new Error(`Missing required environment variable ${name}`);
    return value;
  };
  const development = env.NODE_ENV === "development";
  const developmentAccountId = development ? env.DEV_ACCOUNT_ID : undefined;
  const authQuotaHmacKey = development
    ? (env.AUTH_QUOTA_HMAC_KEY ?? "development-only-auth-quota-key")
    : required("AUTH_QUOTA_HMAC_KEY");
  const cognitoDomain = developmentAccountId
    ? env.COGNITO_DOMAIN
    : required("COGNITO_DOMAIN");
  const cognitoClientId = developmentAccountId
    ? env.COGNITO_CLIENT_ID
    : required("COGNITO_CLIENT_ID");
  const cognitoIssuer = env.COGNITO_ISSUER?.trim();
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error("PORT must be an integer between 1 and 65535");
  const databaseUrl = required("DATABASE_URL");
  if (
    !databaseUrl.startsWith("postgresql://") &&
    !databaseUrl.startsWith("postgres://")
  )
    throw new Error("DATABASE_URL must be a PostgreSQL URL");
  const parseOrigin = (name: string, fallback: string) => {
    const value = env[name] ?? fallback;
    const url = new URL(value);
    if (
      (!development && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error(
        `${name} must be a bare${development ? " HTTP(S)" : " HTTPS"} origin`,
      );
    return url.origin;
  };
  const controlOrigin = parseOrigin(
    "CONTROL_ORIGIN",
    "https://opensidebar.com",
  );
  const targetOrigin = parseOrigin(
    "TARGET_ORIGIN",
    "https://play.opensidebar.com",
  );
  if (new URL(controlOrigin).hostname === new URL(targetOrigin).hostname)
    throw new Error(
      "CONTROL_ORIGIN and TARGET_ORIGIN must use different hosts",
    );
  if (!development && env.COOKIE_SECURE === "false")
    throw new Error("COOKIE_SECURE cannot be disabled outside development");
  if (cognitoDomain && new URL(cognitoDomain).protocol !== "https:")
    throw new Error("COGNITO_DOMAIN must use HTTPS");
  if (cognitoIssuer) {
    const issuer = new URL(cognitoIssuer);
    if (issuer.protocol !== "https:" || issuer.search || issuer.hash)
      throw new Error("COGNITO_ISSUER must be an HTTPS issuer URL");
  }
  const enabled = (name: string) => env[name] === "true";
  const cloudControlEnabled = enabled("CLOUD_CONTROL_ENABLED");
  const cloudSessionsEnabled =
    cloudControlEnabled && enabled("CLOUD_SESSIONS_ENABLED");
  const remoteMissionsEnabled =
    cloudSessionsEnabled && enabled("REMOTE_MISSIONS_ENABLED");
  const hostedMcpEnabled =
    remoteMissionsEnabled && enabled("HOSTED_MCP_ENABLED");
  const checkpointWritesEnabled =
    cloudSessionsEnabled && enabled("CHECKPOINT_WRITES_ENABLED");
  const checkpointRestoreEnabled =
    cloudSessionsEnabled && enabled("CHECKPOINT_RESTORE_ENABLED");
  const sessionExportsEnabled =
    cloudSessionsEnabled && enabled("SESSION_EXPORTS_ENABLED");
  const deviceCommandsEnabled =
    cloudSessionsEnabled && enabled("DEVICE_COMMANDS_ENABLED");
  const temporalShadowEnabled =
    cloudSessionsEnabled && enabled("TEMPORAL_SHADOW_ENABLED");
  const temporalShadowToken = env.TEMPORAL_SHADOW_TOKEN?.trim();
  const temporalShadowHashKey = env.TEMPORAL_SHADOW_HASH_KEY?.trim();
  if (
    temporalShadowEnabled &&
    (!temporalShadowToken ||
      temporalShadowToken.length < 32 ||
      !temporalShadowHashKey ||
      temporalShadowHashKey.length < 32)
  )
    throw new Error(
      "TEMPORAL_SHADOW_TOKEN and TEMPORAL_SHADOW_HASH_KEY must each contain at least 32 characters",
    );
  const extensionId = env.OPENSIDEBAR_EXTENSION_ID?.trim();
  const extensionTestIds = new Set(
    (env.OPENSIDEBAR_EXTENSION_TEST_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if ([...extensionTestIds].some((id) => !/^[a-p]{32}$/.test(id)))
    throw new Error(
      "OPENSIDEBAR_EXTENSION_TEST_IDS must contain comma-separated Chrome extension ids",
    );
  const extensionClientId = env.COGNITO_EXTENSION_CLIENT_ID?.trim();
  const cognitoMcpClientId = env.COGNITO_MCP_CLIENT_ID?.trim();
  const mcpScopePrefix =
    env.MCP_SCOPE_PREFIX?.trim() || `${controlOrigin}/mcp/`;
  const credentialKmsKeyId = env.CREDENTIAL_KMS_KEY_ID?.trim();
  const sessionKmsKeyId = env.SESSION_KMS_KEY_ID?.trim();
  const sessionBucketName = env.SESSION_BUCKET_NAME?.trim();
  const traceSyncEnabled = cloudControlEnabled && enabled("TRACE_SYNC_ENABLED");
  const traceUploadsEnabled =
    traceSyncEnabled && enabled("TRACE_UPLOADS_ENABLED");
  const traceDownloadsEnabled =
    traceSyncEnabled && enabled("TRACE_DOWNLOADS_ENABLED");
  const traceBucketName = env.TRACE_BUCKET_NAME?.trim();
  if (cloudControlEnabled && (!extensionId || !/^[a-p]{32}$/.test(extensionId)))
    throw new Error(
      "OPENSIDEBAR_EXTENSION_ID must be a pinned Chrome extension id",
    );
  if (cloudControlEnabled && !extensionClientId)
    throw new Error("COGNITO_EXTENSION_CLIENT_ID is required");
  if (hostedMcpEnabled && !cognitoMcpClientId)
    throw new Error("COGNITO_MCP_CLIENT_ID is required when hosted MCP is enabled");
  if (hostedMcpEnabled && !cognitoDomain)
    throw new Error("COGNITO_DOMAIN is required when hosted MCP is enabled");
  if (hostedMcpEnabled && !cognitoIssuer)
    throw new Error("COGNITO_ISSUER is required when hosted MCP is enabled");
  if (hostedMcpEnabled && cognitoMcpClientId === extensionClientId)
    throw new Error("COGNITO_MCP_CLIENT_ID must be separate from the extension client");
  if (hostedMcpEnabled && (!mcpScopePrefix.endsWith("/") || mcpScopePrefix.length > 80))
    throw new Error("MCP_SCOPE_PREFIX must be a bounded scope namespace ending in /");
  if (enabled("CREDENTIAL_WRITES_ENABLED") && !credentialKmsKeyId)
    throw new Error("CREDENTIAL_KMS_KEY_ID is required");
  if (
    (checkpointWritesEnabled ||
      checkpointRestoreEnabled ||
      sessionExportsEnabled ||
      remoteMissionsEnabled) &&
    (!sessionKmsKeyId || !sessionBucketName)
  )
    throw new Error(
      "SESSION_KMS_KEY_ID and SESSION_BUCKET_NAME are required for checkpoints",
    );
  if (
    sessionKmsKeyId &&
    credentialKmsKeyId &&
    sessionKmsKeyId === credentialKmsKeyId
  )
    throw new Error("Session and credential KMS keys must be different");
  if (traceSyncEnabled && !traceBucketName)
    throw new Error("TRACE_BUCKET_NAME is required when trace sync is enabled");
  const relayModelAllowlist = new Set(
    (env.RELAY_MODEL_ALLOWLIST ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (enabled("RELAY_ENABLED") && relayModelAllowlist.size === 0)
    throw new Error("RELAY_MODEL_ALLOWLIST is required");
  const cloudTesterSubjects = new Set(
    (env.CLOUD_TESTER_SUBJECTS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const cloudSessionTesterSubjects = new Set(
    (env.CLOUD_SESSION_TESTER_SUBJECTS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const cloudOperatorSubjects = new Set(
    (env.CLOUD_OPERATOR_SUBJECTS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const traceTesterSubjects = new Set(
    (env.TRACE_TESTER_SUBJECTS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const subject of traceTesterSubjects) {
    if (!cloudTesterSubjects.has(subject))
      throw new Error(
        "TRACE_TESTER_SUBJECTS must be a subset of CLOUD_TESTER_SUBJECTS",
      );
  }
  if (traceSyncEnabled && traceTesterSubjects.size === 0)
    throw new Error(
      "TRACE_TESTER_SUBJECTS requires at least one named tester when trace sync is enabled",
    );
  for (const subject of cloudSessionTesterSubjects) {
    if (!cloudTesterSubjects.has(subject))
      throw new Error(
        "CLOUD_SESSION_TESTER_SUBJECTS must be a subset of CLOUD_TESTER_SUBJECTS",
      );
  }
  for (const subject of cloudOperatorSubjects) {
    if (!cloudTesterSubjects.has(subject))
      throw new Error(
        "CLOUD_OPERATOR_SUBJECTS must be a subset of CLOUD_TESTER_SUBJECTS",
      );
  }
  if (cloudSessionsEnabled && cloudSessionTesterSubjects.size === 0)
    throw new Error(
      "CLOUD_SESSION_TESTER_SUBJECTS requires at least one named tester when cloud sessions are enabled",
    );
  return {
    port,
    databaseUrl,
    controlOrigin,
    targetOrigin,
    cookieSecure: env.COOKIE_SECURE !== "false",
    developmentAccountId,
    cognitoDomain,
    cognitoIssuer,
    cognitoClientId,
    awsRegion: env.AWS_REGION ?? "eu-central-1",
    authQuotaHmacKey,
    controlDatabaseUrl: env.CONTROL_DATABASE_URL ?? databaseUrl,
    cloudControlEnabled,
    extensionAuthEnabled:
      cloudControlEnabled && enabled("EXTENSION_AUTH_ENABLED"),
    credentialWritesEnabled:
      cloudControlEnabled && enabled("CREDENTIAL_WRITES_ENABLED"),
    relayEnabled: cloudControlEnabled && enabled("RELAY_ENABLED"),
    preferenceWritesEnabled:
      cloudControlEnabled && enabled("PREFERENCE_WRITES_ENABLED"),
    cloudSessionsEnabled,
    checkpointWritesEnabled,
    checkpointRestoreEnabled,
    sessionExportsEnabled,
    deviceCommandsEnabled,
    deviceTakeoverEnabled:
      deviceCommandsEnabled && enabled("DEVICE_TAKEOVER_ENABLED"),
    remoteMissionsEnabled,
    hostedMcpEnabled,
    cognitoMcpClientId,
    mcpScopePrefix,
    temporalShadowEnabled,
    temporalShadowToken,
    temporalShadowHashKey,
    temporalCoordinationEnabled:
      temporalShadowEnabled &&
      deviceCommandsEnabled &&
      enabled("TEMPORAL_COORDINATION_ENABLED"),
    extensionClientId,
    extensionId,
    extensionTestIds,
    credentialKmsKeyId,
    sessionKmsKeyId,
    sessionBucketName,
    traceSyncEnabled,
    traceUploadsEnabled,
    traceDownloadsEnabled,
    traceBucketName,
    traceTesterSubjects,
    cloudTesterSubjects,
    cloudSessionTesterSubjects,
    cloudOperatorSubjects,
    relayModelAllowlist,
  };
}
