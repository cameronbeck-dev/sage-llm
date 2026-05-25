import { useState } from 'react';
import type { Message, WhisperAction } from '@sage/shared';
import EntryViewerModal from '../EntryViewerModal.js';
import type { Target as EntryTarget } from '../EntryViewerModal.js';
import WikiPageModal from '../wiki/WikiPageModal.js';
import DeferredOpsModal from '../wiki/DeferredOpsModal.js';

interface WhisperActionsProps {
  message: Message;
  onUpdate: (updated: Message) => void;
}

const WIKI_OP_KINDS = new Set([
  'wiki_page_created',
  'wiki_page_updated',
  'wiki_page_deleted',
  'wiki_link_added',
]);

export default function WhisperActions({ message, onUpdate }: WhisperActionsProps) {
  const actions = message.whisperActions;
  const [loading, setLoading] = useState<number | null>(null);
  const [viewTarget, setViewTarget] = useState<EntryTarget | null>(null);
  const [wikiPath, setWikiPath] = useState<string | null>(null);
  const [wikiVersionId, setWikiVersionId] = useState<string | undefined>(undefined);
  const [deferredOpsOpen, setDeferredOpsOpen] = useState(false);

  if (!actions || actions.length === 0) return null;

  async function handleAction(index: number, action: WhisperAction) {
    if (action.kind === 'view_entry') {
      setViewTarget(action.target);
      return;
    }
    if (action.kind === 'view_wiki_page') {
      setWikiPath(action.path);
      setWikiVersionId(action.versionId);
      return;
    }
    if (action.kind === 'view_fact') {
      setViewTarget({ type: 'fact', factId: action.factId });
      return;
    }
    if (action.kind === 'review_deferred_ops') {
      setDeferredOpsOpen(true);
      return;
    }
    if (
      action.kind === 'wiki_page_created' ||
      action.kind === 'wiki_page_updated' ||
      action.kind === 'wiki_page_deleted' ||
      action.kind === 'wiki_link_added'
    ) {
      setWikiPath(action.kind === 'wiki_link_added' ? action.source : action.path);
      setWikiVersionId(undefined);
      return;
    }
    setLoading(index);
    try {
      const res = await fetch(`/api/whispers/${message.id}/actions/${index}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) return;
      const updated = (await res.json()) as Message;
      onUpdate(updated);
    } finally {
      setLoading(null);
    }
  }

  const wikiOpActions = actions.filter(a => WIKI_OP_KINDS.has(a.kind));
  const otherActions = actions.filter(a => !WIKI_OP_KINDS.has(a.kind));
  const collapseWikiOps = wikiOpActions.length >= 4;

  function renderButton(action: WhisperAction, i: number) {
    return (
      <button
        key={i}
        className="whisper-actions__button"
        type="button"
        disabled={loading !== null || action.consumedAt != null}
        style={action.consumedAt != null ? { opacity: 0.4, cursor: 'default' } : undefined}
        onClick={() => handleAction(i, action)}
      >
        {loading === i ? '…' : action.label}
      </button>
    );
  }

  return (
    <>
      <div className="whisper-actions">
        <div className="whisper-actions__buttons">
          {collapseWikiOps ? (
            <details style={{ display: 'inline-block' }}>
              <summary className="whisper-actions__button" style={{ cursor: 'pointer', listStyle: 'none' }}>
                Updated {wikiOpActions.length} wiki pages — view changes
              </summary>
              <div style={{ paddingTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {wikiOpActions.map((action, i) => renderButton(action, actions.indexOf(action)))}
              </div>
            </details>
          ) : (
            wikiOpActions.map((action) => renderButton(action, actions.indexOf(action)))
          )}
          {otherActions.map((action) => renderButton(action, actions.indexOf(action)))}
        </div>
      </div>
      {viewTarget && (
        <EntryViewerModal
          isOpen={true}
          onClose={() => setViewTarget(null)}
          target={viewTarget}
        />
      )}
      {wikiPath && (
        <WikiPageModal
          isOpen={true}
          onClose={() => { setWikiPath(null); setWikiVersionId(undefined); }}
          path={wikiPath}
          versionId={wikiVersionId}
        />
      )}
      {deferredOpsOpen && (
        <DeferredOpsModal
          isOpen={true}
          onClose={() => setDeferredOpsOpen(false)}
        />
      )}
    </>
  );
}
