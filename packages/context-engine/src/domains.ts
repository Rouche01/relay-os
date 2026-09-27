/** Prefix facts so search stays useful before a dedicated VoltMem profile exists. */
export function formatFact(domain: string | undefined, text: string): string {
  const body = text.trim();
  if (!domain) return body;
  return `[${domain}] ${body}`;
}

/** Build the block injected into drafter / LLM prompts. */
export function formatMemoryPromptBlock(memories: string[]): string {
  const lines = memories.map((m) => m.trim()).filter(Boolean);
  if (lines.length === 0) return "";
  return ["[AGENT MEMORY]", ...lines.map((l) => `- ${l}`), "[/AGENT MEMORY]"].join("\n");
}
