# Design Consistency Refactor — Implementation Plan

## Approach

The refactor works from the inside out: fix broken token references first, then canonicalize the button and input systems (pure CSS), then introduce shared CSS classes for repeated structural patterns (popovers, tables, cards), then extract React components where JSX duplication is the real problem (BackButton, ConfirmInline; **NOT** DataTable, **NOT** PopoverMenu), then migrate the delete-account modal to ConfirmModal, and finally sweep every file's remaining inline styles into classes. No new libraries.

---

## Phase 1 — Tokens

In `packages/client/src/styles/tokens.css`, append to `:root`:

```css
--color-surface-2: rgba(127,127,127,0.15);
--color-border: var(--border-dim);
--danger-border: rgba(220,50,50,0.5);
--danger-border-strong: rgba(220,50,50,0.7);
--overlay-subtle: rgba(255,255,255,0.07);
```

Rationale: `--color-surface-2` (used in `globals.css:348`) and `--color-border` (used in `globals.css:357`) are aliases for fallback values already referenced by existing CSS. **`--color-surface` is NOT added** — its only caller is the inline delete-account modal in `Settings.tsx:90`, which Phase 5 deletes entirely; aliasing it would only introduce a new public token with no callers and could mislead future readers because the fallback hex `#1a1a1a` and `--bg-surface` (`#272b24`) are visually distinct. The `--danger-border*` and `--overlay-subtle` tokens replace hardcoded rgba literals used across multiple files.

---

## Phase 2 — Button system

In `packages/client/src/styles/pixel.css`, add `.btn--danger-outline` after the existing `.btn--sm` block:

```css
.btn--danger-outline {
  border-color: var(--danger-border);
  color: var(--danger);
  background: var(--bg-raised);
}
.btn--danger-outline:hover:not(:disabled) {
  border-color: var(--danger-border-strong);
  color: var(--danger);
}
```

`.btn--danger` (filled) already exists in `globals.css:1216`. **Do not duplicate.**

Move `.btn--stop` from `globals.css` (currently ~lines 1388-1395) into `pixel.css` next to other `.btn*` variants. Verify no duplicate remains in `globals.css`.

**Bespoke buttons that stay as-is (with reason):**
- `.whisper-actions__button` — intentionally ghost/link-style
- `.code-block-copy` — micro icon-button scoped to code blocks
- `.chat-empty-state__chip` — suggestion chip, visually distinct
- `.api-key-btn` family — has hover-to-danger semantics not shared with `.btn`
- `.btn--github` — login-only
- Hamburger / sidebar new-btn — icon-only and scoped

---

## Phase 3 — Shared CSS classes (in `globals.css`)

### 3a. `.popover-menu` (shared popover for new Packs migration)

Insert before the `/* ── Memory Page ──` section (~line 1523):

```css
.popover-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 100;
  background: var(--bg-raised);
  border: 2px solid var(--border);
  border-radius: var(--radius);
  padding: 6px;
  min-width: 180px;
  box-shadow: var(--shadow);
}
.popover-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  background: transparent;
  border: none;
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.popover-menu__item:hover { background: var(--bg-surface); color: var(--accent); }
.popover-menu__item--danger:hover { color: var(--danger); background: var(--bg-surface); }
.popover-menu__separator { height: 1px; background: var(--border-dim); margin: 4px 0; }
.popover-menu__label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  font-size: 13px;
  cursor: pointer;
}
```

**Do not migrate** `.model-picker-popover` or `.user-menu__dropdown` — those work and have different structural needs.

### 3b. `.data-table` (BEM)

```css
.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table__th { text-align: left; padding: 6px 8px; font-weight: 600; color: var(--text-muted); border-bottom: 1px solid var(--border); }
.data-table__th--right { text-align: right; }
.data-table__td { padding: 6px 8px; border-top: 1px solid var(--overlay-subtle); }
.data-table__td--right { text-align: right; }
.data-table__td--muted { opacity: 0.6; }
.data-table--compact .data-table__th,
.data-table--compact .data-table__td { padding: 4px 8px; }
```

### 3c. `.card` family

```css
.card {
  background: var(--bg-surface);
  border: 2px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 16px 20px;
}
.card--flat {
  box-shadow: none;
  border-left: none;
  border-right: none;
  border-top: none;
  border-radius: 0;
  border-bottom: 1px solid var(--border-dim);
  padding: 12px 0;
}
.card--danger { border-color: var(--danger-border); }
.card--interactive { cursor: pointer; transition: border-color 120ms, background 120ms; }
.card--interactive:hover { border-color: var(--accent-dim); background: var(--bg-raised); }
```

**Existing card-like classes that are NOT touched** (intentional or specialized): `.settings-section`, `.pack-card`, `.api-key-section`, `.login-card`, `.message-bubble__content`.

### 3d. Input fixes

- `.settings-input` and `.settings-textarea` borders: change `1px` → `2px`.
- `.api-key-input` background: `var(--bg)` → `var(--bg-surface)`.
- Add new `.chat-input` definition:

```css
.chat-input {
  background: var(--bg-surface);
  border: 2px solid var(--border);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 14px;
  padding: 10px 12px;
  border-radius: var(--radius);
  outline: none;
  resize: none;
  flex: 1;
  min-height: 44px;
  max-height: 200px;
}
.chat-input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(108,240,138,0.15); }
```

Then apply `className="chat-input"` to the `<textarea>` in `Chat.tsx`.

---

## Phase 4 — Shared React components

### 4a. `BackButton` — `components/ui/BackButton.tsx`

```tsx
import { Link } from 'react-router-dom';

interface BackButtonProps {
  to?: string;     // default "/chat"
  label?: string;  // default "Back"
}

export default function BackButton({ to = '/chat', label = 'Back' }: BackButtonProps) {
  return (
    <Link to={to} className="btn btn--sm">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginRight: 4 }}>
        <path d="M8 5H2M2 5L5 2M2 5L5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {label}
    </Link>
  );
}
```

The SVG `marginRight: 4` stays inline — it's layout glue, not styling that needs a token.

Apply in `Memory.tsx`, `Knowledge.tsx`, `Import.tsx`, `Usage.tsx`. Verify each page's current `Link to="..."` target before defaulting; pass `to="/settings"` if the page links there.

### 4b. `ConfirmInline` — `components/ui/ConfirmInline.tsx`

```tsx
interface ConfirmInlineProps {
  prompt: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

export default function ConfirmInline({ prompt, onConfirm, onCancel, confirmLabel = 'Yes', cancelLabel = 'Cancel' }: ConfirmInlineProps) {
  return (
    <div className="confirm-inline">
      <span className="settings-info">{prompt}</span>
      <button className="btn btn--sm btn--danger-outline" onClick={onConfirm}>{confirmLabel}</button>
      <button className="btn btn--sm" onClick={onCancel}>{cancelLabel}</button>
    </div>
  );
}
```

Add to globals.css:

```css
.confirm-inline { display: inline-flex; align-items: center; gap: 6px; }
```

Apply in `Memory.tsx` (Forget?) and `Knowledge.tsx` (Delete pack?).

### 4c. Decisions — components NOT extracted

- **DataTable** → not extracted. Three callers each have different columns, conditional cells, click handlers. The `.data-table` CSS class is the right level of abstraction.
- **PopoverMenu** → not extracted. The Packs picker has checkbox-label rows, structurally different from UserMenu / ModelPicker item-button rows. CSS class `.popover-menu` is the right tool.

---

## Phase 5 — Modal reuse

Migrate `Settings.tsx` delete-account modal to `ConfirmModal`. Requires extending `ConfirmModal` with an optional text-input gate.

### 5a. Extend `ConfirmModal.tsx`

Add prop `confirmationText?: string`. When set:
- Render an input between the message and actions.
- Add a `disabled` attribute to the confirm `<button>` (the existing button has no `disabled` prop today — add it).
- Reset `inputVal` to `''` via `useEffect` on `isOpen` going false.
- **Block the Enter-key shortcut from bypassing the gate.** The existing `handleKey` (line 25-28) listens for Enter and calls `onConfirm()` directly. When `confirmationText` is set, the Enter handler must check the gate the same way the button does.

```tsx
const [inputVal, setInputVal] = useState('');
useEffect(() => { if (!isOpen) setInputVal(''); }, [isOpen]);

// In the existing Enter handler, gate the call:
function handleKey(e: KeyboardEvent) {
  if (e.key === 'Escape') onCancel();
  else if (e.key === 'Enter') {
    if (confirmationText && inputVal !== confirmationText) return;
    onConfirm();
  }
}
// Include inputVal and confirmationText in the effect's dependency array.

// JSX between message and actions:
{confirmationText && (
  <input
    className="settings-input"
    type="text"
    value={inputVal}
    onChange={e => setInputVal(e.target.value)}
    placeholder={`Type ${confirmationText} to confirm`}
    autoFocus
  />
)}

// Confirm button:
<button
  className={danger ? 'btn btn--danger' : 'btn btn--primary'}
  onClick={onConfirm}
  disabled={confirmationText ? inputVal !== confirmationText : false}
>
  {confirmLabel ?? 'Confirm'}
</button>
```

Backward compatibility: all existing callers omit `confirmationText`, so `disabled` evaluates to `false` and the Enter-key short-circuit is unchanged. The `useState` and the `useEffect` reset are no-ops when the prop is absent.

### 5b. Replace inline modal in `Settings.tsx` `DangerZone`

Delete the entire `{deleteModalOpen && (<div style={{...}}>...)}` block. Replace with:

```tsx
<ConfirmModal
  isOpen={deleteModalOpen}
  title="Delete account"
  message="This will permanently delete your account, all conversations, messages, and stored data."
  confirmLabel={deleting ? 'Deleting...' : 'Confirm delete'}
  danger
  confirmationText="DELETE"
  onConfirm={handleDelete}
  onCancel={() => setDeleteModalOpen(false)}
/>
```

Remove now-unused `confirmText` / `setConfirmText` state. Keep `handleDelete`'s internal `if (confirmText !== 'DELETE') return;` guard? — guard is no longer needed because the modal owns the input; remove the dead state, simplify `handleDelete` to no longer reference `confirmText`.

---

## Phase 6 — Inline-style purge

### 6a. Utility classes (add to globals.css)

```css
.u-flex         { display: flex; }
.u-flex-wrap    { flex-wrap: wrap; }
.u-gap-8        { gap: 8px; }
.u-gap-12       { gap: 12px; }
.u-gap-16       { gap: 16px; }
.u-mt-4         { margin-top: 4px; }
.u-mt-8         { margin-top: 8px; }
.u-mt-12        { margin-top: 12px; }
.u-mt-16        { margin-top: 16px; }
.u-mb-8         { margin-bottom: 8px; }
.u-mb-12        { margin-bottom: 12px; }
.u-mb-16        { margin-bottom: 16px; }
.u-text-right   { text-align: right; }
.u-muted        { opacity: 0.6; }
.u-muted-5      { opacity: 0.5; }
.u-font-11      { font-size: 11px; }
.u-w-full       { width: 100%; }
.u-hidden       { display: none; }
.u-cursor-pointer { cursor: pointer; }
```

Also add these tiny purpose-built classes:

```css
.settings-info--danger  { color: var(--danger); }
.settings-info--warning { color: var(--warning); }
.settings-section__title--danger { color: var(--danger); }
.import-errors-list { margin-top: 4px; padding-left: 16px; }
.status-badge { font-size: 11px; font-weight: 600; }
.packs-picker { position: relative; margin-left: auto; }
.knowledge-drop-zone {
  border: 2px dashed var(--border);
  border-radius: var(--radius);
  padding: 20px;
  text-align: center;
  margin-bottom: 16px;
  cursor: pointer;
}
```

### 6b. Per-file changes

**`Settings.tsx` (DangerZone area):**
- `<section style={{ borderColor: 'rgba(220,50,50,0.5)' }}>` → `className="settings-section pixel-border card--danger"`.
- `<h2 style={{ color: '#e05555' }}>` → `className="settings-section__title settings-section__title--danger"`.
- `<p style={{ opacity:0.7, marginBottom:16 }}>` → `className="settings-info u-muted u-mb-16"`.
- `<div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>` → `className="u-flex u-gap-12 u-flex-wrap"`.
- 4× `<button style={{ borderColor:'...', color:'#e05555' }}>` → `className="btn btn--danger-outline"`.

**`Memory.tsx`:**
- Back button → `<BackButton />`.
- Forget confirm → `<ConfirmInline prompt="Forget?" onConfirm={...} onCancel={...} />` wrapped in `<div className="memory-entry__actions">`.
- `<h2 style={{ marginBottom:12 }}>` → `className="settings-section__title u-mb-12"`.
- `<p style={{ marginBottom:8 }}>` → `className="settings-info u-mb-8"`.
- Restore button `style={{ color:'var(--accent)' }}` — keep (token reference is acceptable) OR move to a class if desired.

**`Knowledge.tsx`:**
- Back button → `<BackButton />`.
- Delete-pack confirm → `<ConfirmInline prompt="Delete pack?" onConfirm={...} onCancel={...} />`.
- Drop-zone div → `className="knowledge-drop-zone"`.
- `<p style={{ fontSize:11, opacity:0.5, marginTop:4 }}>` → `className="settings-info u-font-11 u-muted-5 u-mt-4"`.
- `<input type="file" style={{ display:'none' }}>` → `className="u-hidden"`.
- `<p style={{ opacity:0.6 }}>No files yet</p>` → `className="settings-info u-muted"`.
- Upload error `<p style={{ color:'var(--danger)' }}>` → `className="settings-info settings-info--danger"`.
- `<table style={{...}}>` → `<table className="data-table">`. All `<th>` / `<td>` use BEM modifiers. **Important:** remove the inline `style={{ borderBottom: '1px solid var(--border)' }}` from the header `<tr>` (Knowledge.tsx ~line 234) — the `.data-table__th { border-bottom }` rule now handles the header separator, and leaving the row-level border would double-line with the first data row's new `.data-table__td { border-top }`. Similarly remove any inline `borderBottom` from data-row `<tr>`s (rows separators come from cell `border-top` now).
- `<span style={{ fontSize:11, opacity:0.7 }}>` source cell → `className="u-font-11 u-muted"`.
- `StatusBadge`: extract size/weight to `.status-badge` class; keep dynamic `color: colors[status]` inline. Change `'#4caf50'` → `'var(--accent)'` in the colors map (the ready state should use the app's green token).

**`Import.tsx`:**
- Back button → `<BackButton />`.
- Stats table → `<table className="data-table data-table--compact">`. Cells use `data-table__td`, `data-table__td--muted`, `data-table__td--right`.
- Past Imports table → `<table className="data-table">`. Header `<th>` → `data-table__th` (+ `--right` as needed).
- Row `<tr style={{ borderTop:'...', cursor:'pointer' }}>` → `<tr className="u-cursor-pointer">` (border moved to `.data-table__td`).
- `<details style={{ marginTop:8 }}>` → `className="u-mt-8"`.
- `<ul style={{ marginTop:4, paddingLeft:16 }}>` → `className="import-errors-list"`.
- `<li style={{ color:'#e0a055' }}>` → `className="settings-info settings-info--warning"`.
- `<p style={{ opacity:0.6 }}>` → `className="settings-info u-muted"`.
- `<p style={{ marginTop:8, opacity:0.6 }}>` → `className="settings-info u-mt-8 u-muted"`.
- `<div style={{ marginTop:16 }}>` → `className="u-mt-16"`.

**`Usage.tsx`:**
- Back button → `<BackButton />` (verify `to`).
- All tables → `<table className="data-table">`. Same BEM application.
- Border-top inline styles removed (handled by `.data-table__td`).
- `<p style={{ opacity:0.6 }}>` → `className="settings-info u-muted"`.

**`Chat.tsx`:**
- Packs picker wrapper `<div style={{ position:'relative', marginLeft:'auto' }}>` → `className="packs-picker"`.
- Packs picker popover `<div style={{...}}>` → `className="popover-menu"`.
- Packs picker label rows → `className="popover-menu__label"`.
- Empty packs `<p style={{ fontSize:12, opacity:0.6, padding:4 }}>` → `className="settings-info u-muted"`.
- Chat textarea → `className="chat-input"`.
- Keep `style={{ opacity: action.consumedAt != null ? 0.4 : undefined }}` and other genuinely-dynamic styles (cursor and display toggles tied to state).
- Keep SVG `style={{ marginRight: 4 }}` spacers inline — they are layout glue.

---

## Phase 7 — Touchpoint list

**CSS files modified:**
- `styles/tokens.css` — Phase 1 token aliases.
- `styles/pixel.css` — Phase 2 `.btn--danger-outline`, move `.btn--stop`.
- `styles/globals.css` — Phase 3 (`.popover-menu`, `.data-table`, `.card`), input fixes, `.confirm-inline`, `.knowledge-drop-zone`, `.chat-input`, utility classes, helper modifiers.

**New components:**
- `components/ui/BackButton.tsx`
- `components/ui/ConfirmInline.tsx`

**Modified components:**
- `components/ui/ConfirmModal.tsx` (add `confirmationText` prop).

**Pages modified:**
- `pages/Settings.tsx`
- `pages/Memory.tsx`
- `pages/Knowledge.tsx`
- `pages/Import.tsx`
- `pages/Usage.tsx`
- `pages/Chat.tsx`

---

## Verification checklist (user-facing)

- **Settings → Danger Zone:** red-tinted border (subtle), danger-color title, 4 buttons styled as outline-danger; clicking "Delete my account" opens `ConfirmModal` with a text input — must type "DELETE" to enable the confirm button; Escape closes.
- **Settings → API keys:** inputs now use 2px borders.
- **Memory → Entries:** "Forget?" inline confirm uses the new component with outline-danger Yes button.
- **Knowledge:** "Delete pack?" inline confirm matches Memory's. Drop zone and files table look unchanged. Status badges still show colored text; ready state uses `var(--accent)` green.
- **Import:** stats and history tables look unchanged. Warning list rows are `var(--warning)` (visually nearly identical to old `#e0a055`).
- **Usage:** tables look unchanged.
- **Chat:** Packs picker popover unchanged appearance. Chat textarea now has a visible 2px border (previously unstyled — it inherited from `body`). Whisper rows, message bubbles, and sidebar items unchanged.

---

## Edge cases / gotchas

- `ConfirmModal` input must reset when `isOpen` flips to false (or it'll retain "DELETE" between opens).
- After moving `.btn--stop`, confirm no duplicate definition remains in `globals.css`.
- `.data-table__td { border-top }` shifts the row-separator semantics: previously some tables used `border-bottom` on `<tr>`, now we use `border-top` on `<td>`. The first data row will now have a top border. To avoid a double-line at the header/body boundary, **every inline `borderBottom` on a header `<tr>` and `borderTop`/`borderBottom` on data rows must be removed during the migration.** The Knowledge table is the highest risk — verify it visually post-implementation: there should be exactly one separator between the header and the first data row.
- `BackButton` default `to="/chat"`. Inspect each page's existing Link target before applying; Usage may need `to="/settings"`.
- `StatusBadge` `#4caf50` becomes `var(--accent)` — slight color shift, intentional consistency win.
- `.btn--danger-outline` inherits `.btn` base, so it keeps the pixel-press transform on hover — desired.

---

## Out of scope

- Visual redesign / new motion / accessibility audit / responsive changes.
- Migrating ModelPicker/UserMenu to `.popover-menu`.
- README update (no user-facing feature change).
- Touching `.api-key-btn` family.
