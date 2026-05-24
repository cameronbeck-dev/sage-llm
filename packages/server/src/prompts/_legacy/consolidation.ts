export interface ConsolidationOutput {
  packName: string;
  packDescription: string;
  includedOrphanIds: string[];
}

export function buildConsolidationPrompt(
  orphans: Array<{ id: string; extractedText: string; signalTypes: string[] }>
): string {
  const orphansAsJson = JSON.stringify(
    orphans.map(o => ({ id: o.id, text: o.extractedText, tags: o.signalTypes }))
  );

  return `You are clustering a group of standalone notes the user has produced into a
proposed knowledge pack. All notes share a working topic label, but you must
produce a clean pack name and a one-sentence description suitable for a UI
card.

Rules:
- packName: 1-4 words, Title Case, no punctuation. Should feel like a
  project, theme, or domain the user clearly has.
- packDescription: one sentence, max 140 chars, describing what kinds of
  notes belong in this pack.
- includedOrphanIds: include every id you are confident belongs in this pack.
  Exclude any obvious outliers.

NOTES (each with an id):
${orphansAsJson}

Output ONLY valid JSON:
{
  "packName": "string",
  "packDescription": "string",
  "includedOrphanIds": ["uuid", "..."]
}`;
}
