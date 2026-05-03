interface StubProps {
  title: string;
}

export default function Stub({ title }: StubProps) {
  return (
    <div className="stub-page">
      <h1>{title}</h1>
      <p className="text-muted">Coming in Phase 2.</p>
    </div>
  );
}
