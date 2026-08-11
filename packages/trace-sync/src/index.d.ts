export type TraceBundleSummary = {
    traceId: string;
    title: string;
    createdAt: string;
    entryCount: number;
    screenshotCount: number;
    bundleSchemaVersion: string;
};
export type EncryptedTraceHeader = TraceBundleSummary & {
    envelopeVersion: 1;
    algorithm: "AES-256-GCM+A256KW";
    keyFingerprint: string;
    iv: string;
    wrappedDataKey: string;
};
export type DecryptedTrace = {
    header: EncryptedTraceHeader;
    bundle: Record<string, unknown>;
};
export declare function createRecoveryKey(): Promise<string>;
export declare function recoveryKeyFingerprint(recoveryKey: string): Promise<string>;
export declare function summarizeTraceBundle(bundle: Record<string, unknown>): TraceBundleSummary;
export declare function encryptTraceBundle(bundle: Record<string, unknown>, recoveryKey: string): Promise<Uint8Array>;
export declare function inspectEncryptedTrace(envelope: Uint8Array): EncryptedTraceHeader;
export declare function decryptTraceBundle(envelope: Uint8Array, recoveryKey: string): Promise<DecryptedTrace>;
