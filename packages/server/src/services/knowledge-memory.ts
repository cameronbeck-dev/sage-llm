import { getPool } from '../db/pool.js';
import { getUserSettings } from './settings.js';
import { getDecryptedCredential, CredentialNotFoundError } from './credentials.js';
import { getProvider } from '../providers/registry.js';
import { listMessages, createMessage } from './messages.js';
import { chunkText, insertChunks } from './knowledge-chunker.js';
import { logger } from '../logger.js';
import type { ContentBlock } from '@sage/shared';

const EXTRACTION_PROMPT = `You are a knowledge extractor. Given a short conversation excerpt, identify factual takeaways worth saving to a knowledge pack.

Output a bulleted list of concise facts. Only include things that are genuinely informative and worth preserving. If there is nothing worth extracting, output an empty response.

Format:
- Fact one
- Fact two
...`;

export async function reviewKnowledgePack(
  userId: string,
  conversationId: string,
  packId: string
): Promise<void> {
  try {
    const messages = await listMessages(conversationId, 4);
    const recent = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-2);

    if (recent.length === 0) return;

    const transcript = recent
      .map(m => {
        const text = m.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map(b => b.text)
          .join('');
        return `${m.role}: ${text}`;
      })
      .join('\n\n');

    const settings = await getUserSettings(userId);
    let apiKey: string;
    try {
      apiKey = await getDecryptedCredential(userId, settings.activeProvider);
    } catch (err) {
      if (err instanceof CredentialNotFoundError) return;
      throw err;
    }

    const provider = getProvider(settings.activeProvider);
    const model = settings.activeModel;
    const creds = { apiKey };

    const prompt = `${EXTRACTION_PROMPT}\n\nConversation:\n${transcript}`;

    let extracted = '';
    for await (const chunk of provider.chatStream({ model, messages: [{ role: 'user', content: prompt }] }, creds)) {
      if (chunk.type === 'delta' && chunk.text) {
        extracted += chunk.text;
      } else if (chunk.type === 'error') {
        throw new Error(chunk.error);
      }
    }

    const trimmed = extracted.trim();
    if (!trimmed) return;

    const pool = getPool();
    const timestamp = Date.now();
    const filename = `chat-extracted-${timestamp}.md`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO knowledge_files (pack_id, filename, source_kind, status, raw_text)
         VALUES ($1, $2, 'chat_extracted', 'ready', $3)
         RETURNING id`,
        [packId, filename, trimmed]
      );
      const fileId = rows[0].id;
      const chunks = chunkText(trimmed, 'text/markdown', filename);
      await insertChunks(client, fileId, packId, chunks);
      await client.query('COMMIT');

      const systemContent: ContentBlock[] = [{ type: 'text', text: prompt }];
      await createMessage(conversationId, 'system_internal', systemContent, settings.activeProvider, model);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err, conversationId, packId }, '[knowledge] reviewKnowledgePack failed');
  }
}
