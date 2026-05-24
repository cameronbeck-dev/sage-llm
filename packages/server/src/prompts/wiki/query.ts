export function buildQueryPrompt(opts: {
  index: string;
  recentUserMessage: string;
}): string {
  const { index, recentUserMessage } = opts;

  return `You are the Sage wiki context selector.

WIKI INDEX:
${index}

USER MESSAGE:
${recentUserMessage}

Return a JSON object with up to 5 wiki page paths that are most relevant to this user message.
Output ONLY valid JSON: {"paths": ["path/to/page.md", ...]}
If nothing is relevant, return {"paths": []}.`;
}
