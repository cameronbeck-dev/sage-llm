import { Link } from 'react-router-dom';

interface BackButtonProps {
  to?: string;
  label?: string;
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
