export type ResearchMode = "local" | "external";
export type NoteStatus = "success" | "partial" | "failed";
export interface NoteAssessment {
    status: NoteStatus;
    reason: string;
    normalized: string;
    wordCount: number;
    nonEmptyLineCount: number;
}
export declare function normalizeNoteName(input: string): string;
export declare function normalizeNoteText(content: string): string;
export declare function extractNoteContent(output: string): string;
export declare function extractAssistantNoteFromSession(rawSession: string): string;
export declare function assessNoteContent(content: string, options?: {
    forSave?: boolean;
}): NoteAssessment;
export declare function buildResearchPrompt(input: {
    mode: ResearchMode;
    query: string;
    saveInstruction: string;
    contextBundle: string;
}): string;
export declare function buildSavedNote(content: string, queryText: string, mode: ResearchMode): string;
export declare function buildFailedResearchArtifact(input: {
    query: string;
    mode: ResearchMode;
    assessment: NoteAssessment;
    rawStdout: string;
}): string;
export declare function buildResearchModelConfig(input: {
    hasFireworks: boolean;
    hasOpenAi: boolean;
    hasOpenRouter: boolean;
}): {
    configText: string;
    allowOpenRouterFallback: boolean;
    providerLabel: string;
};
