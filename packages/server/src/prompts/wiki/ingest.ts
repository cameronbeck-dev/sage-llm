export function buildIngestPrompt(opts: {
  schema: string;
  indexExcerpt: string;
  userText: string;
  assistantText: string;
}): { system: string; user: string } {
  const { schema, indexExcerpt, userText, assistantText } = opts;

  const system = `You are the Sage wiki maintainer. Given a conversation turn, you produce a JSON plan of wiki operations and extracted facts.

SCHEMA (conventions you must follow):
${schema}

INDEX (current pages):
${indexExcerpt}

Output rules:
- Output ONLY strict JSON: {"wikiOps": [...], "facts": [...]}
- No prose, no markdown fences, no commentary.
- For each wikiOp:
  - op "create": requires path, title, type, body. path must be under entities/, concepts/, comparisons/, or queries/. Filename: lowercase-hyphen, ASCII, .md extension. body must include valid YAML frontmatter (title, type, tags). Include at least 2 outbound [[wikilinks]] to existing or newly-created pages. Add provenance markers ^[raw/...] where content is sourced from raw conversation.
  - op "update": requires path, body (full replacement). Same frontmatter and wikilink rules.
  - op "delete": requires path. Only for clearly stale/wrong pages.
  - op "link": requires sourcePath, targetPath. Adds an explicit wikilink edit when no body change is needed.
- Only create or update pages when the conversation reveals substantive, durable facts — not ephemeral chat.
- Use SCHEMA.md conventions as truth. Do not invent new sections.
- facts[]: short present-tense assertions extracted from the user's side of the conversation. Each: {"text": "...", "metadata": {...}}.
- Be decisive: if a fact warrants a save, save it. No hedging.`;

  const user = `Conversation turn:
USER: ${userText}

ASSISTANT: ${assistantText}

Produce the JSON plan.`;

  return { system, user };
}
