import './styles/globals.css';

export default function App() {
  return (
    <div className="sage-root">
      <div className="sage-hello">
        <div className="sage-avatar" aria-label="Sage character" />
        <div className="sage-dialog">
          <p className="sage-dialog-text">Hello, Sage.</p>
          <p className="sage-dialog-sub">Your wise companion for every LLM conversation.</p>
        </div>
      </div>
    </div>
  );
}
