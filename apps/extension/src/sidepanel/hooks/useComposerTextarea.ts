import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
} from "react";

const MAX_TEXTAREA_HEIGHT = 120;

export function useComposerTextarea({
  isAgentRunning,
  inputText,
  interactionPending,
  onSubmit,
  onStop,
}: {
  isAgentRunning: boolean;
  inputText: string;
  interactionPending: boolean;
  onSubmit: () => void;
  onStop: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shouldRestoreComposerFocusRef = useRef(false);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const scrollHeight = Math.min(
      textarea.scrollHeight,
      MAX_TEXTAREA_HEIGHT,
    );
    textarea.style.height = `${scrollHeight}px`;
    textarea.style.overflowY =
      scrollHeight >= MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [inputText, resizeTextarea]);

  useLayoutEffect(() => {
    if (interactionPending) return;
    if (!shouldRestoreComposerFocusRef.current) return;
    textareaRef.current?.focus({ preventScroll: true });
  }, [interactionPending, isAgentRunning]);

  useEffect(() => {
    if (!isAgentRunning) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onStop();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isAgentRunning, onStop]);

  const handleFocus = useCallback(() => {
    shouldRestoreComposerFocusRef.current = true;
  }, []);

  const handleBlur = useCallback(() => {
    window.setTimeout(() => {
      if (document.activeElement !== textareaRef.current) {
        shouldRestoreComposerFocusRef.current = false;
      }
    }, 0);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        onSubmit();
      }
    },
    [onSubmit],
  );

  return {
    textareaRef,
    handleBlur,
    handleFocus,
    handleKeyDown,
  };
}
