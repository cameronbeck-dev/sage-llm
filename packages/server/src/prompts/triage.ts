export interface TriageDestination {
  kind: 'memory' | 'existing_pack' | 'orphan';
  packId?: string;
  suggestedTopic?: string;
  extractedText: string;
  displaySummary: string;
}

export interface TriageOutput {
  hasExtractable: boolean;
  importance: 1 | 2 | 3 | 4 | 5;
  signalTypes: string[];
  destinations: TriageDestination[];
}

export function buildTriagePrompt(opts: {
  packs: Array<{ id: string; name: string; description: string | null }>;
  memoryEntryCount: number;
  lastAssistantText: string;
  lastUserText: string;
}): string {
  const { packs, memoryEntryCount, lastAssistantText, lastUserText } = opts;
  const packListJson = JSON.stringify(packs.map(p => ({ id: p.id, name: p.name, description: p.description })));

  return `You are the post-turn triage step for Sage. Decide what (if anything) in the
latest exchange is worth capturing, and where it belongs.

Rules:
- Extract facts ATTRIBUTED TO THE USER. Use the assistant turn only to
  disambiguate short user replies (e.g. "yes" after a yes/no question).
- Never extract the assistant's claims, suggestions, or summaries as facts.
- importance scale 1-5:
   1 — pure chitchat, no fact
   2 — trivial preference or transient state
   3 — concrete preference, mild project detail, biographical scrap
   4 — substantive project detail, decision, identity-level fact
   5 — major life event, hard-coded user preference, foundational project context
- destinations[] may contain 0..N entries. One turn can populate memory AND a pack.
- For each fact, pick exactly one destination:
   memory          — autobiographical, preferences, identity, general working context
   existing_pack   — content thematically matches an existing pack (set packId)
   orphan          — substantive but doesn't fit any existing pack and isn't general
                     memory material (typically: domain-specific to an unnamed topic).
                     Set suggestedTopic to a short topic label (1-3 words, lowercase).
- Project-specific or domain-specific content (a tech stack detail, a recipe,
  a research note about a named topic) NEVER goes to memory. It goes to an
  existing_pack if one matches, or to orphan otherwise.
- signalTypes is freeform tags for telemetry: ["preference", "decision",
  "project_context", "identity", "task", etc.]

Inputs:
USER'S PACKS:
${packListJson}
MEMORY SIZE: ${memoryEntryCount} entries
LAST ASSISTANT:
${lastAssistantText}
LAST USER:
${lastUserText}

Rules for displaySummary:
- ≤80 chars, third-person present tense.
- No meta-commentary ("Saved the user's preference about X") — just the compressed fact ("Prefers tabs over spaces", "Teelo uses Postgres partitioned by month").
- The UI prefixes it with the destination kind, so do NOT include a prefix like "Saved to memory:" or "Added to Teelo:".

Output ONLY valid JSON matching this exact shape:
{
  "hasExtractable": boolean,
  "importance": 1 | 2 | 3 | 4 | 5,
  "signalTypes": string[],
  "destinations": [
    {
      "kind": "memory" | "existing_pack" | "orphan",
      "packId": "string (required when kind === 'existing_pack')",
      "suggestedTopic": "string (required when kind === 'orphan')",
      "extractedText": "string — the fact, phrased as a third-person statement about the user",
      "displaySummary": "string — ≤80 chars, third-person present, no prefix, suitable for UI confirmation"
    }
  ]
}

No prose, no markdown fences. JSON only.`;
}
