import { getPool } from '../db/pool.js';
import { getProvider } from '../providers/registry.js';
import { getUserSettings } from '../services/settings.js';
import { getDecryptedCredential, CredentialNotFoundError } from '../services/credentials.js';
import { listMemoryEntries } from '../services/_legacy/memory.js';
import { getPack } from '../services/_legacy/knowledge.js';
import { createMessage } from '../services/messages.js';

async function loadPackChunks(packId: string, charLimit = 6000): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query<{ text: string }>(
    `SELECT text FROM knowledge_chunks WHERE pack_id = $1 ORDER BY created_at ASC LIMIT 20`,
    [packId]
  );
  const chunks: string[] = [];
  let total = 0;
  for (const row of rows) {
    const text = row.text ?? '';
    if (total + text.length > charLimit) break;
    chunks.push(text);
    total += text.length;
  }
  return chunks;
}

export async function buildPackOpener(userId: string, packId: string, conversationId: string): Promise<string> {
  const pack = await getPack(userId, packId);
  if (!pack) {
    return `Hey — let's expand your pack. What would you like to capture?`;
  }

  const fallback = `Hey — let's expand your **${pack.name}** pack. What would you like to capture?`;

  try {
    const settings = await getUserSettings(userId);
    let apiKey: string;
    try {
      apiKey = await getDecryptedCredential(userId, settings.activeProvider);
    } catch (err) {
      if (err instanceof CredentialNotFoundError) {
        throw new Error('No API key available for pack opener');
      }
      throw err;
    }

    const chunks = await loadPackChunks(packId);
    const entries = await listMemoryEntries(userId);
    const memorySnippets = [...entries]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 30)
      .map(e => `${e.key}: ${e.body}`);

    const chunkSection = chunks.length > 0
      ? `PACK CONTENT SAMPLES:\n${chunks.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')}`
      : `PACK CONTENT SAMPLES:\n(none yet — this is a new pack)`;

    const memorySection = memorySnippets.length > 0
      ? `USER CONTEXT:\n${memorySnippets.join('\n')}`
      : `USER CONTEXT:\n(none)`;

    const prompt = `You are Sage, a personal AI assistant. The user just clicked "Talk to Sage" on their "${pack.name}" pack${pack.description ? ` (${pack.description})` : ''}.

Your job is to write a warm, inviting opener message that welcomes them and surfaces 2-3 specific directions worth exploring, drawn from what's actually in the pack and what you know about the user.

Tone: warm and curious. Give the user permission to lead — they should feel they can take this anywhere. Don't be generic. If the pack is about recipes, talk about recipes. If it's about a research topic, surface that topic. Reference specific things from the pack content when possible.

End with a single open question that invites them to go wherever feels most interesting.

Output only the message text. No quotes, no markdown headers, no preamble.

${chunkSection}

${memorySection}

Pack name: ${pack.name}${pack.description ? `\nPack description: ${pack.description}` : ''}`;

    const provider = getProvider(settings.activeProvider);
    const model = settings.activeModel;
    const creds = { apiKey };

    let output = '';
    // @model-routing-tag: opener
    for await (const chunk of provider.chatStream({ model, messages: [{ role: 'user', content: prompt }] }, creds)) {
      if (chunk.type === 'delta' && chunk.text) {
        output += chunk.text;
      } else if (chunk.type === 'error') {
        throw new Error(chunk.error);
      }
    }

    const opener = output.trim();
    if (!opener) return fallback;

    await createMessage(conversationId, 'system_internal', [{ type: 'text', text: prompt }], settings.activeProvider, model);

    return opener;
  } catch {
    return fallback;
  }
}
