import { randomUUID } from 'node:crypto';
import { getPool } from '../../db/pool.js';
import { getProvider } from '../../providers/registry.js';
import { getUserSettings } from '../settings.js';
import { getDecryptedCredential, CredentialNotFoundError } from '../credentials.js';
import { listMessages, createMessage, updateMessageWhisperActions } from '../messages.js';
import { listMemoryEntries, applyMemoryOps } from './memory.js';
import { listPacks } from './knowledge.js';
import { insertOrphan, findPendingClusters, loadClusterOrphans, markConsolidated } from './orphans.js';
import { buildTriagePrompt } from '../../prompts/_legacy/triage.js';
import { buildDedupPrompt } from '../../prompts/_legacy/dedup.js';
import { buildConsolidationPrompt } from '../../prompts/_legacy/consolidation.js';
import { extractJson } from '../docs.js';
import { chunkText, insertChunks } from '../knowledge-chunker.js';
import { logger } from '../../logger.js';
import { PRE_TRIAGE_LABELS, MEMORY_LABELS, EXISTING_PACK_LABELS, ORPHAN_LABELS, CONSOLIDATION_LABELS, pickRandom } from '../../prompts/_legacy/indicator-copy.js';
import type { ContentBlock, MemoryOp, WhisperAction, SSEChunk } from '@sage/shared';
import type { TriageOutput } from '../../prompts/_legacy/triage.js';
import type { DedupOutput } from '../../prompts/_legacy/dedup.js';
import type { ConsolidationOutput } from '../../prompts/_legacy/consolidation.js';

// TODO: if user pack count crosses ~20, triage cost and accuracy will degrade — add a hard cap.

function extractTextFromContent(content: { type: string; text?: string }[]): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('');
}

async function callLlm(
  userId: string,
  conversationId: string,
  prompt: string,
  tag: string
): Promise<string> {
  const settings = await getUserSettings(userId);
  let apiKey: string;
  try {
    apiKey = await getDecryptedCredential(userId, settings.activeProvider);
  } catch (err) {
    if (err instanceof CredentialNotFoundError) {
      throw new Error(`No API key available for ${tag}`);
    }
    throw err;
  }

  const provider = getProvider(settings.activeProvider);
  const model = settings.activeModel;
  const creds = { apiKey };

  let output = '';
  for await (const chunk of provider.chatStream(
    { model, messages: [{ role: 'user', content: prompt }] },
    creds
  )) {
    if (chunk.type === 'delta' && chunk.text) {
      output += chunk.text;
    } else if (chunk.type === 'error') {
      throw new Error(chunk.error);
    }
  }

  const systemContent: ContentBlock[] = [{ type: 'text', text: `[${tag}] ${prompt}` }];
  await createMessage(conversationId, 'system_internal', systemContent, settings.activeProvider, model);

  return output;
}

export async function insertPackChunk(
  userId: string,
  packId: string,
  conversationId: string,
  messageId: string | null,
  text: string
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('insertPackChunk: empty text');

  const pool = getPool();
  const filename = `chat-extracted-${Date.now()}.md`;

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

    const { rows: chunkRows } = await client.query<{ id: string }>(
      `SELECT id FROM knowledge_chunks WHERE file_id = $1 ORDER BY chunk_index ASC LIMIT 1`,
      [fileId]
    );
    const chunkId = chunkRows[0]?.id ?? fileId;

    await client.query('COMMIT');
    return chunkId;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, packId }, '[extraction] insertPackChunk failed');
    throw err;
  } finally {
    client.release();
  }
}

export async function* extractAfterTurn(
  userId: string,
  conversationId: string,
  userMessageId: string,
  assistantMessageId: string
): AsyncGenerator<SSEChunk> {
  const allMessages = await listMessages(conversationId, 1000);

  const userMsg = allMessages.find(m => m.id === userMessageId);
  const assistantMsg = allMessages.find(m => m.id === assistantMessageId);

  if (!userMsg || !assistantMsg) return;

  const lastUserText = extractTextFromContent(userMsg.content as { type: string; text?: string }[]);
  const lastAssistantText = extractTextFromContent(assistantMsg.content as { type: string; text?: string }[]);

  if (!lastUserText) return;

  // Heuristic pre-filter: combined word count < 19 or pure-acknowledgement
  const combinedWords = `${lastUserText} ${lastAssistantText}`.split(/\s+/).filter(Boolean).length;
  const ackPattern = /^\s*(yes|no|ok|okay|sure|thanks|thank you|got it|cool|nice|right|exactly|👍|👌)\s*[.!?]?\s*$/i;
  if (combinedWords < 19 || ackPattern.test(lastUserText)) return;

  try {
    yield { type: 'extraction_progress', stage: 'started', label: pickRandom(PRE_TRIAGE_LABELS) };

    const [packs, memoryEntries] = await Promise.all([
      listPacks(userId),
      listMemoryEntries(userId),
    ]);

    const triagePrompt = buildTriagePrompt({
      packs: packs.map(p => ({ id: p.id, name: p.name, description: p.description })),
      memoryEntryCount: memoryEntries.length,
      lastAssistantText,
      lastUserText,
    });

    // @model-routing-tag: triage
    const triageRaw = await callLlm(userId, conversationId, triagePrompt, 'triage');
    const triage = extractJson<TriageOutput>(triageRaw);

    if (!triage || !triage.hasExtractable || triage.importance < 3) return;
    if (!Array.isArray(triage.destinations) || triage.destinations.length === 0) return;

    const pool = getPool();

    // Hoist pack name lookups so labels can be built before starting the loop.
    const existingPackIds = triage.destinations
      .filter(d => d.kind === 'existing_pack' && d.packId)
      .map(d => d.packId as string);
    const packNameById = new Map<string, string>();
    if (existingPackIds.length > 0) {
      const { rows: packRows } = await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM knowledge_packs WHERE id = ANY($1::uuid[])`,
        [existingPackIds]
      );
      for (const row of packRows) {
        packNameById.set(row.id, row.name);
      }
    }

    // Build indicators with stable UUIDs per destination.
    const destinationIds: string[] = [];
    const indicators = triage.destinations.map(destination => {
      const id = randomUUID();
      destinationIds.push(id);
      let label: string;
      if (destination.kind === 'memory') {
        label = pickRandom(MEMORY_LABELS);
      } else if (destination.kind === 'existing_pack') {
        const packName = destination.packId ? (packNameById.get(destination.packId) ?? 'a pack') : 'a pack';
        label = pickRandom(EXISTING_PACK_LABELS).replace('{packName}', packName);
      } else {
        label = pickRandom(ORPHAN_LABELS);
      }
      return { id, label };
    });

    yield { type: 'extraction_progress', stage: 'destinations_known', indicators };

    for (let i = 0; i < triage.destinations.length; i++) {
      const destination = triage.destinations[i];
      const destinationId = destinationIds[i];
      const displaySummary = (destination.displaySummary && destination.displaySummary.trim())
        ? destination.displaySummary.trim()
        : destination.extractedText.slice(0, 80);

      if (destination.kind === 'memory') {
        const key = triage.signalTypes[0]
          ?? destination.extractedText.split(/\s+/).slice(0, 6).join('_').toLowerCase().replace(/[^a-z0-9_]/g, '');

        const op: MemoryOp = {
          op: 'add',
          key,
          body: destination.extractedText,
          type: 'other',
          summary: `Triage-extracted: ${destination.extractedText.slice(0, 80)}`,
        };
        const { applied } = await applyMemoryOps(userId, [op], conversationId, userMessageId);

        if (applied.length > 0) {
          const addedEntry = applied.find(a => a.op === 'add');
          if (addedEntry) {
            const whisperActions: WhisperAction[] = [
              { kind: 'undo_memory', entryId: addedEntry.entryId, label: 'Undo' },
              { kind: 'view_entry', label: 'View', target: { type: 'memory', entryId: addedEntry.entryId } },
              { kind: 'dismiss', label: 'Dismiss' },
            ];
            const content: ContentBlock[] = [
              { type: 'text', text: `Saved to memory: ${displaySummary}` },
            ];
            await createMessage(
              conversationId,
              'whisper',
              content,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              whisperActions
            );
            yield { type: 'extraction_progress', stage: 'destination_complete', completedId: destinationId };
          }
        }

      } else if (destination.kind === 'existing_pack') {
        if (!destination.packId) continue;

        const { rows: attachRows } = await pool.query<{ auto_extract: boolean; pack_name: string }>(
          `SELECT ckp.auto_extract, kp.name AS pack_name
           FROM conversation_knowledge_packs ckp
           JOIN knowledge_packs kp ON kp.id = ckp.pack_id
           WHERE ckp.conversation_id = $1 AND ckp.pack_id = $2`,
          [conversationId, destination.packId]
        );
        const attachment = attachRows[0] ?? null;

        const { rows: recentChunks } = await pool.query<{ text: string }>(
          `SELECT text FROM knowledge_chunks
           WHERE pack_id = $1
           ORDER BY created_at DESC LIMIT 10`,
          [destination.packId]
        );
        const existingTexts = recentChunks.map(r => r.text);

        if (existingTexts.length > 0) {
          const dedupPrompt = buildDedupPrompt(destination.extractedText, existingTexts);
          // @model-routing-tag: dedup
          const dedupRaw = await callLlm(userId, conversationId, dedupPrompt, 'dedup');
          const dedup = extractJson<DedupOutput>(dedupRaw);
          if (dedup?.duplicate) continue;
        }

        const chunkId = await insertPackChunk(
          userId,
          destination.packId,
          conversationId,
          userMessageId,
          destination.extractedText
        );

        const packName = attachment?.pack_name ?? (packNameById.get(destination.packId) ?? 'a pack');
        const whisperActions: WhisperAction[] = attachment?.auto_extract
          ? [
              { kind: 'undo_extraction', chunkId, label: 'Undo' },
              { kind: 'view_entry', label: 'View', target: { type: 'chunk', packId: destination.packId, chunkId } },
              { kind: 'dismiss', label: 'Dismiss' },
            ]
          : [
              { kind: 'undo_extraction', chunkId, label: 'Undo' },
              { kind: 'view_entry', label: 'View', target: { type: 'chunk', packId: destination.packId, chunkId } },
              { kind: 'always_extract_to_pack', packId: destination.packId, label: `Always extract to ${packName}` },
              { kind: 'dismiss', label: 'Dismiss' },
            ];
        const content: ContentBlock[] = [
          { type: 'text', text: `Saved to **${packName}**: ${displaySummary}` },
        ];
        await createMessage(
          conversationId,
          'whisper',
          content,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          whisperActions
        );
        yield { type: 'extraction_progress', stage: 'destination_complete', completedId: destinationId };

      } else if (destination.kind === 'orphan') {
        const suggestedTopic = destination.suggestedTopic
          ?? (triage.signalTypes[0] || 'misc');

        const orphanId = await insertOrphan({
          userId,
          conversationId,
          messageId: userMessageId,
          extractedText: destination.extractedText,
          signalTypes: triage.signalTypes,
          importance: triage.importance,
          suggestedTopic,
        });

        const whisperActions: WhisperAction[] = [
          { kind: 'undo_orphan', orphanId, label: 'Undo' },
          { kind: 'dismiss', label: 'Dismiss' },
        ];
        const content: ContentBlock[] = [
          { type: 'text', text: `Noted: ${displaySummary}` },
        ];
        await createMessage(
          conversationId,
          'whisper',
          content,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          whisperActions
        );
        yield { type: 'extraction_progress', stage: 'destination_complete', completedId: destinationId };
      }
    }

    // Consolidation trigger — count query at end of extraction
    const pendingClusters = await findPendingClusters(userId);
    for (const cluster of pendingClusters) {
      const orphans = await loadClusterOrphans(userId, cluster.suggestedTopic);
      if (orphans.length === 0) continue;

      const consolidationId = randomUUID();
      yield {
        type: 'extraction_progress',
        stage: 'destinations_known',
        indicators: [{ id: consolidationId, label: pickRandom(CONSOLIDATION_LABELS) }],
      };

      const consolidationPrompt = buildConsolidationPrompt(orphans);
      // @model-routing-tag: consolidation
      const consolidationRaw = await callLlm(userId, conversationId, consolidationPrompt, 'consolidation');
      const consolidation = extractJson<ConsolidationOutput>(consolidationRaw);

      if (!consolidation) continue;

      // Mark consolidated regardless of user action (per A7)
      await markConsolidated(orphans.map(o => o.id));

      const whisperActions: WhisperAction[] = [
        {
          kind: 'create_pack',
          suggestedName: consolidation.packName,
          suggestedDescription: consolidation.packDescription,
          orphanIds: consolidation.includedOrphanIds,
          label: 'Create pack',
        },
        { kind: 'dismiss', label: 'Dismiss' },
      ];
      const content: ContentBlock[] = [
        {
          type: 'text',
          text: `I noticed ${orphans.length} notes about **${cluster.suggestedTopic}** — create a pack?`,
        },
      ];
      await createMessage(
        conversationId,
        'whisper',
        content,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        whisperActions
      );
      yield { type: 'extraction_progress', stage: 'destination_complete', completedId: consolidationId };
    }
  } catch (err) {
    logger.error({ err }, '[extraction] extractAfterTurn failed');
  } finally {
    yield { type: 'extraction_progress', stage: 'finished' };
  }
}
