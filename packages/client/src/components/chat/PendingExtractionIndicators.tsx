import type { ReactNode } from 'react';

interface Props {
  indicators: Array<{ id: string; label: string }>;
}

function renderLabel(label: string): ReactNode {
  const parts = label.split('**');
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part
  );
}

export default function PendingExtractionIndicators({ indicators }: Props) {
  if (indicators.length === 0) return null;
  return (
    <>
      {indicators.map(({ id, label }) => (
        <div key={id} className="extraction-indicator">
          <span className="extraction-indicator__spinner" aria-hidden />
          <span>{renderLabel(label)}</span>
        </div>
      ))}
    </>
  );
}
