import SageAvatar from '../components/sage/SageAvatar.js';

export default function Login() {
  return (
    <div className="login-page">
      <div className="login-card pixel-border-accent">
        <SageAvatar state="idle" />
        <div className="login-card__text">
          <h1 className="login-card__title">Sage</h1>
          <p className="login-card__sub">Your wise companion for every LLM conversation.</p>
        </div>
        <a href="/api/auth/github" className="btn btn--primary btn--github">
          Login with GitHub
        </a>
      </div>
    </div>
  );
}
