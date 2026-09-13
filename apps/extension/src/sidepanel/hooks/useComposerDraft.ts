import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cloudSession } from "../cloud-client";
import {
  discardComposerDraft,
  readComposerDraft,
  writeComposerDraft,
  type ComposerDraftScope,
} from "../composer-draft-storage";
import { uiRuntime } from "../runtime";

export function useComposerDraft(options: {
  text: string;
  workspaceId: string;
  mode: "task" | "guidance";
  setText: (text: string) => void;
}) {
  const { mode, setText, text, workspaceId } = options;
  const [accountId, setAccountId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [saved, setSaved] = useState(false);
  const loadingScope = useRef(0);
  const scope = useMemo<ComposerDraftScope | null>(
    () =>
      accountId
        ? { accountId, workspaceId: workspaceId || "default", mode }
        : null,
    [accountId, mode, workspaceId],
  );

  useEffect(() => {
    let active = true;
    void cloudSession()
      .then((session) => {
        if (active) setAccountId(session?.account.accountId ?? "local");
      })
      .catch(() => {
        if (active) setAccountId("local");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!scope) return;
    const generation = ++loadingScope.current;
    setHydrated(false);
    void readComposerDraft(uiRuntime.storage.local, scope).then((draft) => {
      if (generation !== loadingScope.current) return;
      if (!text && draft) setText(draft);
      setSaved(Boolean(draft));
      setHydrated(true);
    });
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hydrated || !scope) return;
    setSaved(false);
    const timer = window.setTimeout(() => {
      void writeComposerDraft(uiRuntime.storage.local, scope, text).then(() =>
        setSaved(Boolean(text)),
      );
    }, 400);
    return () => window.clearTimeout(timer);
  }, [hydrated, scope, text]);

  const saveNow = useCallback(async () => {
    if (!scope) return;
    await writeComposerDraft(uiRuntime.storage.local, scope, text);
    setSaved(Boolean(text));
  }, [scope, text]);

  const discard = useCallback(async () => {
    if (!scope) return;
    await discardComposerDraft(uiRuntime.storage.local, scope);
    setText("");
    setSaved(false);
  }, [scope, setText]);

  return { saved, saveNow, discard };
}
