import { describe, expect, test } from "vitest";
import { MessageSource } from "../../src/types";
import { isUiMessageSource } from "../../src/background/ui-message-source";

describe("UI message source", () => {
  test("accepts legacy sidepanel and generic UI sources", () => {
    expect(isUiMessageSource(MessageSource.SIDEPANEL)).toBe(true);
    expect(isUiMessageSource(MessageSource.UI)).toBe(true);
  });

  test("rejects non-UI runtime sources", () => {
    expect(isUiMessageSource(MessageSource.BACKGROUND)).toBe(false);
    expect(isUiMessageSource(MessageSource.CONTENT)).toBe(false);
    expect(isUiMessageSource("overlay")).toBe(false);
  });
});
