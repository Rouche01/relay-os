/**
 * Remove em/en dashes from draft copy so HITL never sees the AI tell.
 * Sentence-like breaks (dash before a capital) become periods; otherwise commas.
 */
export function stripEmDashes(text: string): string {
  return text
    .replace(/\s*[—–]\s*(?=[A-Z“"‘])/g, ". ")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .replace(/([.,;:!?]){2,}/g, "$1")
    .trim();
}
