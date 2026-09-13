import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PostgresPlaygroundRepository } from "./postgres-repository.js";
import { CognitoPasswordlessAuthProvider } from "./passwordless-auth.js";
import { ControlAuthService } from "./control-auth.js";
import { CredentialVault } from "./credential-vault.js";
import { PostgresControlRepository } from "./postgres-control-repository.js";
import { RelayService } from "./relay-service.js";
import { PostgresSessionRepository } from "./postgres-session-repository.js";
import { PostgresDeviceCoordinationRepository } from "./postgres-device-coordination-repository.js";
import {
  CheckpointVault,
  S3CheckpointObjectStore,
} from "./checkpoint-vault.js";
import { CommandVault } from "./command-vault.js";
import { PostgresDeviceCommandRepository } from "./postgres-device-command-repository.js";
import { SessionJobWorker } from "./session-job-worker.js";
import { PostgresTraceRepository } from "./postgres-trace-repository.js";
import { TraceObjectStore } from "./trace-object-store.js";
import { PostgresRemoteMissionRepository } from "./postgres-remote-mission-repository.js";
import { RemoteMissionVault } from "./remote-mission-vault.js";
import { createHostedBrowserMcpOperations } from "./hosted-browser-mcp-operations.js";
import { PersonalDataRepository } from "./personal-data-repository.js";
import { DisabledPersonalDataObjectStore, PersonalDataObjectStore } from "./personal-data-object-store.js";
import { PostgresModelBenchRepository } from "./postgres-modelbench-repository.js";

const config = loadConfig();
const repository = new PostgresPlaygroundRepository(config.databaseUrl);
const passwordlessAuth = config.cognitoClientId
  ? new CognitoPasswordlessAuthProvider(
      config.awsRegion,
      config.cognitoClientId,
    )
  : undefined;
await repository.migrate();
await repository.cleanupExpired();
const controlRepository = new PostgresControlRepository(
  config.controlDatabaseUrl,
);
await controlRepository.migrate();
await controlRepository.cleanupExpired();
const personalDataRepository = new PersonalDataRepository(controlRepository.pool);
await personalDataRepository.migrate();
await personalDataRepository.cleanupExpired();
const modelBenchRepository = PostgresModelBenchRepository.fromConnectionString(
  config.controlDatabaseUrl,
);
await modelBenchRepository.migrate();
await modelBenchRepository.cleanupExpired(new Date().toISOString());
const interruptedRelayCutoff = () => new Date(Date.now() - 16 * 60_000);
const recoveredRelayRequests =
  await controlRepository.recoverInterruptedRelayRequests(
    interruptedRelayCutoff(),
  );
if (recoveredRelayRequests > 0)
  console.warn(
    `Recovered ${recoveredRelayRequests} interrupted relay request(s).`,
  );
const sessionRepository = new PostgresSessionRepository(
  config.controlDatabaseUrl,
  config.temporalShadowEnabled && config.temporalShadowHashKey
    ? {
        hashKey: config.temporalShadowHashKey,
        accounts: config.cloudTesterSubjects,
      }
    : undefined,
);
const coordinationRepository = new PostgresDeviceCoordinationRepository(
  sessionRepository.pool,
);
const commandRepository = new PostgresDeviceCommandRepository(
  sessionRepository.pool,
);
const remoteMissionRepository = new PostgresRemoteMissionRepository(
  sessionRepository.pool,
);
await sessionRepository.migrate();
await sessionRepository.cleanupExpired();
const traceRepository = new PostgresTraceRepository(config.controlDatabaseUrl);
await traceRepository.migrate();
const traceObjectStore = config.traceBucketName
  ? new TraceObjectStore(config.traceBucketName)
  : undefined;
const personalDataObjectStore = config.personalDataBucketName
  ? new PersonalDataObjectStore(config.personalDataBucketName)
  : new DisabledPersonalDataObjectStore();
const cleanupPersonalDataObjects = async () => {
  if (!config.personalDataBucketName) return;
  for (const item of await personalDataRepository.pendingObjectDeletions()) {
    try {
      await personalDataObjectStore.delete(item.objectKey);
      await personalDataRepository.completeObjectDeletion(item.accountId, item.objectKey);
    } catch {
      await personalDataRepository.noteObjectDeletionFailure(item.accountId, item.objectKey);
    }
  }
};
await cleanupPersonalDataObjects();
const temporalShadowOutbox = sessionRepository.temporalShadowOutbox;
const vault = config.credentialKmsKeyId
  ? new CredentialVault(controlRepository, config.credentialKmsKeyId)
  : undefined;
const sessionObjectStore = config.sessionBucketName
  ? new S3CheckpointObjectStore(config.sessionBucketName)
  : undefined;
const checkpointVault =
  config.sessionKmsKeyId && config.sessionBucketName
    ? new CheckpointVault(sessionObjectStore!, config.sessionKmsKeyId)
    : undefined;
const commandVault =
  config.sessionKmsKeyId && config.sessionBucketName
    ? new CommandVault(sessionObjectStore!, config.sessionKmsKeyId)
    : undefined;
const remoteMissionVault =
  config.sessionKmsKeyId && sessionObjectStore
    ? new RemoteMissionVault(sessionObjectStore, config.sessionKmsKeyId)
    : undefined;
const hostedBrowserMcpOperations = remoteMissionVault
  ? createHostedBrowserMcpOperations({
      accounts: controlRepository,
      missions: remoteMissionRepository,
      vault: remoteMissionVault,
    })
  : undefined;
const sessionJobs = sessionObjectStore
  ? new SessionJobWorker(sessionRepository.pool, sessionObjectStore)
  : undefined;
const control = {
  repository: controlRepository,
  auth: new ControlAuthService(controlRepository, config),
  vault,
  relay: vault ? new RelayService(controlRepository, vault) : undefined,
  sessionRepository,
  coordinationRepository,
  checkpointVault,
  commandVault,
  commandRepository,
  remoteMissionRepository,
  remoteMissionVault,
  hostedBrowserMcpOperations,
  traceRepository,
  traceObjectStore,
  personalDataRepository,
  personalDataObjectStore,
  modelBenchRepository,
  passwordlessAuth,
};
const server = serve(
  {
    fetch: createApp(
      repository,
      config,
      passwordlessAuth,
      control,
      temporalShadowOutbox,
    ).fetch,
    port: config.port,
  },
  ({ port }) => {
    console.log(`OpenSidebar cloud service listening on :${port}`);
  },
);
const cleanupTimer = setInterval(
  () => {
    void repository
      .cleanupExpired()
      .catch((error) => console.error("expired-record cleanup failed", error));
    void controlRepository
      .cleanupExpired()
      .catch((error) => console.error("control-record cleanup failed", error));
    void personalDataRepository
      .cleanupExpired()
      .catch((error) => console.error("personal-data cleanup failed", error));
    void cleanupPersonalDataObjects()
      .catch((error) => console.error("personal-data object cleanup failed", error));
    void modelBenchRepository
      .cleanupExpired(new Date().toISOString())
      .catch((error) => console.error("modelbench cleanup failed", error));
    void sessionRepository
      .cleanupExpired()
      .catch((error) => console.error("session-record cleanup failed", error));
    void sessionJobs
      ?.cleanupExpiredArtifacts()
      .catch((error) =>
        console.error("session-artifact cleanup failed", error),
      );
    void traceRepository
      .cleanupExpired()
      .then(async (expired) => {
        for (const trace of expired) {
          if (traceObjectStore) await traceObjectStore.delete(trace.objectKey);
          await traceRepository.remove(trace.accountId, trace.traceId);
        }
      })
      .catch((error) => console.error("trace cleanup failed", error));
    void (async () => {
      if (!remoteMissionVault) return;
      for (const mission of await remoteMissionRepository.expired(100)) {
        await remoteMissionVault.delete(mission);
        await remoteMissionRepository.remove(mission.accountId, mission.missionId);
      }
    })().catch((error) => console.error("remote-mission cleanup failed", error));
  },
  60 * 60 * 1000,
);
cleanupTimer.unref();
const relayRecoveryTimer = setInterval(() => {
  void controlRepository
    .recoverInterruptedRelayRequests(interruptedRelayCutoff())
    .catch((error) => console.error("relay recovery failed", error));
}, 60_000);
relayRecoveryTimer.unref();
const sessionJobTimer = setInterval(() => {
  void sessionJobs
    ?.runOnce()
    .catch((error) => console.error("session-job execution failed", error));
}, 5_000);
sessionJobTimer.unref();
const stop = async () => {
  clearInterval(cleanupTimer);
  clearInterval(relayRecoveryTimer);
  clearInterval(sessionJobTimer);
  server.close();
  await Promise.all([
    repository.close(),
    controlRepository.close(),
    sessionRepository.close(),
    traceRepository.close(),
    modelBenchRepository.pool.end(),
  ]);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
