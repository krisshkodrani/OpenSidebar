import DOMPurify from "dompurify";

/** Sanitize HTML from marked.parse() before rendering via dangerouslySetInnerHTML */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty);
}
