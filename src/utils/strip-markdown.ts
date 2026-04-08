/**
 * Strip markdown syntax for clean TTS output.
 * Converts markdown to plain, speakable text.
 */
export function stripMarkdownForTTS(text: string): string {
  return (
    text
      // Remove code blocks (fenced)
      .replace(/```[\s\S]*?```/g, " code block omitted ")
      // Remove inline code
      .replace(/`([^`]+)`/g, "$1")
      // Remove images
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      // Convert links to just text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Remove bold/italic markers
      .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/___(.+?)___/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/_(.+?)_/g, "$1")
      // Remove strikethrough
      .replace(/~~(.+?)~~/g, "$1")
      // Remove headings
      .replace(/^#{1,6}\s+/gm, "")
      // Remove blockquotes
      .replace(/^>\s+/gm, "")
      // Remove horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, "")
      // Remove list markers
      .replace(/^[\s]*[-*+]\s+/gm, "")
      .replace(/^[\s]*\d+\.\s+/gm, "")
      // Remove HTML tags
      .replace(/<[^>]+>/g, "")
      // Collapse whitespace
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+/g, " ")
      .trim()
  );
}
