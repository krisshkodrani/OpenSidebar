import { useCallback } from "react";
import { logger } from "../../utils";
import { uiRuntime } from "../runtime";
import { useStore } from "../store";

export function useSkillRecordingActions(options: {
  closeRecordIntro: () => void;
  closeWebsiteSkills: () => void;
  openRecordIntro: () => void;
  resetRecordIntroPreference: () => void;
  recordIntroDontShowAgain: boolean;
}): {
  handleRecordSkill: () => void;
  handleConfirmRecordIntro: () => Promise<void>;
} {
  const {
    closeRecordIntro,
    closeWebsiteSkills,
    openRecordIntro,
    recordIntroDontShowAgain,
    resetRecordIntroPreference,
  } = options;
  const setError = useStore((s) => s.setError);
  const startSkillRecording = useStore((s) => s.startSkillRecording);
  const recordSkillIntroDismissed = useStore(
    (s) => s.recordSkillIntroDismissed,
  );
  const setRecordSkillIntroDismissed = useStore(
    (s) => s.setRecordSkillIntroDismissed,
  );

  const beginSkillRecording = useCallback(async () => {
    let activeTabId = 0;
    try {
      const tab = await uiRuntime.getActiveTab();
      if (tab?.id) activeTabId = tab.id;
    } catch (error) {
      logger.warn("ui", "Failed to get active tab for skill recording", {
        error,
      });
    }
    if (!activeTabId) {
      setError("Open a normal web page before recording a site skill.");
      return;
    }
    await startSkillRecording(activeTabId);
    closeRecordIntro();
    closeWebsiteSkills();
  }, [closeRecordIntro, closeWebsiteSkills, setError, startSkillRecording]);

  const handleRecordSkill = useCallback(() => {
    if (recordSkillIntroDismissed) {
      void beginSkillRecording();
    } else {
      resetRecordIntroPreference();
      openRecordIntro();
    }
  }, [
    beginSkillRecording,
    openRecordIntro,
    recordSkillIntroDismissed,
    resetRecordIntroPreference,
  ]);

  const handleConfirmRecordIntro = useCallback(async () => {
    if (recordIntroDontShowAgain) {
      await setRecordSkillIntroDismissed(true);
    }
    await beginSkillRecording();
  }, [beginSkillRecording, recordIntroDontShowAgain, setRecordSkillIntroDismissed]);

  return { handleRecordSkill, handleConfirmRecordIntro };
}
