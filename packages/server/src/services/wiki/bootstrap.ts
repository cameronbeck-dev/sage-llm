import { getObjectStore } from '../../storage/index.js';
import { SCHEMA_KEY, INDEX_KEY } from './layout.js';

const DEFAULT_SCHEMA = `# Sage Wiki — Schema & Conventions

## Page Sections

- **entities/** — Real-world people, pets, places, objects (e.g. \`entities/teelo.md\`)
- **concepts/** — Ideas, practices, beliefs, recurring themes (e.g. \`concepts/morning-routine.md\`)
- **comparisons/** — Side-by-side analysis of two or more things (e.g. \`comparisons/cat-food-brands.md\`)
- **queries/** — Open questions, research threads (e.g. \`queries/best-local-vet.md\`)
- **raw/** — Source material, excerpts, unprocessed notes

## Naming Rules

- Filenames: lowercase, hyphen-separated, ASCII only (e.g. \`teelo.md\`, \`morning-routine.md\`)
- No spaces, no underscores, no uppercase
- Prefer specific names over generic ones (\`entities/teelo.md\` not \`entities/my-cat.md\`)

## Frontmatter

Every page should open with YAML frontmatter:

\`\`\`yaml
---
title: Teelo
type: entity
tags: [cat, pet]
---
\`\`\`

## Cross-References

- Link to other pages with \`[[entities/teelo.md]]\` or \`[[entities/teelo.md|Teelo]]\`
- All links are tracked; broken links are flagged in wiki_links.target_page_id = null

## Provenance Markers

- Cite source raw pages with \`^[raw/filename.md]\`
- These create provenance links in wiki_links with kind='provenance'

## Queries Subfolder

Queries can live under \`queries/unfiled/\` if not yet categorized.
`;

const DEFAULT_INDEX = `# Index

_No pages yet._
`;

export async function ensureBootstrap(userId: string): Promise<void> {
  const store = getObjectStore();
  const schemaKey = SCHEMA_KEY(userId);
  const indexKey = INDEX_KEY(userId);

  let schemaMissing = false;
  try {
    await store.get(schemaKey);
  } catch {
    schemaMissing = true;
  }

  if (schemaMissing) {
    await store.put(schemaKey, Buffer.from(DEFAULT_SCHEMA, 'utf-8'));
  }

  let indexMissing = false;
  try {
    await store.get(indexKey);
  } catch {
    indexMissing = true;
  }

  if (indexMissing) {
    await store.put(indexKey, Buffer.from(DEFAULT_INDEX, 'utf-8'));
  }
}
