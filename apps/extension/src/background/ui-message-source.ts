import { MessageSource } from "../types";

export type UiMessageSource = MessageSource.SIDEPANEL | MessageSource.UI;

export function isUiMessageSource(source: unknown): source is UiMessageSource {
  return source === MessageSource.SIDEPANEL || source === MessageSource.UI;
}
