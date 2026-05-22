export interface DedupOutput {
  duplicate: boolean;
  reason?: string;
}

export function buildDedupPrompt(candidate: string, existing: string[]): string {
  const formatted = [
    'CANDIDATE FACT:',
    candidate,
    '',
    'EXISTING CHUNKS IN PACK:',
    ...existing.map((c, i) => `[${i + 1}] ${c}`),
  ].join('\n');

  return `You are checking whether a candidate fact about the user is already captured
in an existing knowledge pack.

A duplicate means the candidate is restating, paraphrasing, or making a strict
subset claim of one of the existing chunks. If the candidate adds any new
detail, qualifier, decision, date, or scope — it is NOT a duplicate.

${formatted}

Output ONLY valid JSON:
{
  "duplicate": boolean,
  "reason": "string — one short sentence"
}`;
}
