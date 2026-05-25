import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  body: string;
  frontmatter?: Record<string, unknown>;
  onWikilinkClick?: (target: string) => void;
}

function preprocessWikilinks(body: string): string {
  return body.replace(/\[\[([^\]]+)\]\]/g, (_match, target: string) => {
    return `[${target}](wiki://${encodeURIComponent(target)})`;
  });
}

function FrontmatterBadges({ frontmatter }: { frontmatter: Record<string, unknown> }) {
  const entries = Object.entries(frontmatter).filter(([k]) => k !== 'body');
  if (entries.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
      {entries.map(([key, value]) => (
        <span key={key} className="memory-entry__type" style={{ fontSize: '0.75rem' }}>
          {key}: {String(value)}
        </span>
      ))}
    </div>
  );
}

export default function WikiRenderer({ body, frontmatter = {}, onWikilinkClick }: Props) {
  const processed = preprocessWikilinks(body);

  return (
    <>
      <FrontmatterBadges frontmatter={frontmatter} />
      <div className="memory-entry" style={{ borderBottom: 'none', paddingBottom: 0 }}>
        <div className="memory-entry__body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a({ href, children, ...rest }) {
                if (href && href.startsWith('wiki://')) {
                  const target = decodeURIComponent(href.slice(7));
                  return (
                    <a
                      {...rest}
                      href="#"
                      onClick={e => {
                        e.preventDefault();
                        onWikilinkClick?.(target);
                      }}
                    >
                      {children}
                    </a>
                  );
                }
                return <a href={href} {...rest} target="_blank" rel="noreferrer">{children}</a>;
              },
            }}
          >
            {processed}
          </ReactMarkdown>
        </div>
      </div>
    </>
  );
}
