import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

interface User {
  avatarUrl?: string | null;
  login: string;
}

interface Props {
  user: User;
  onLogout: () => void;
}

export default function UserMenu({ user, onLogout }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false);
    }

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  function handleLogout() {
    setIsOpen(false);
    onLogout();
  }

  return (
    <div className="user-menu" ref={wrapperRef}>
      <button
        className="user-menu__trigger"
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        {user.avatarUrl && (
          <img
            src={user.avatarUrl}
            alt={user.login}
            className="user-menu__avatar pixel-sprite"
            width={24}
            height={24}
          />
        )}
        <span className="user-menu__username">{user.login}</span>
        <span className="user-menu__caret" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <path d="M2 4l4 4 4-4H2z"/>
          </svg>
        </span>
      </button>
      {isOpen && (
        <div className="user-menu__popover" role="menu">
          <Link
            className="user-menu__item"
            to="/usage"
            role="menuitem"
            onClick={() => setIsOpen(false)}
          >
            <span className="user-menu__icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="8" width="3" height="7"/>
                <rect x="6" y="5" width="3" height="10"/>
                <rect x="11" y="2" width="3" height="13"/>
              </svg>
            </span>
            Usage
          </Link>
          <Link
            className="user-menu__item"
            to="/memory"
            role="menuitem"
            onClick={() => setIsOpen(false)}
          >
            <span className="user-menu__icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 2h9a2 2 0 0 1 2 2v10l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L2 14V2zm1 1.5v8.5l1.5-1 2 1.5 2-1.5 2 1.5 2-1.5V4a.5.5 0 0 0-.5-.5H3z"/>
                <rect x="4.5" y="5" width="6" height="1"/>
                <rect x="4.5" y="7" width="6" height="1"/>
                <rect x="4.5" y="9" width="4" height="1"/>
              </svg>
            </span>
            Memory
          </Link>
          <Link
            className="user-menu__item"
            to="/settings"
            role="menuitem"
            onClick={() => setIsOpen(false)}
          >
            <span className="user-menu__icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 5a3 3 0 1 0 0 6A3 3 0 0 0 8 5zm0 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/>
                <path d="M6.5 1h3l.5 1.5c.4.2.8.4 1.1.7L13 2.5l2 2-1 1.8c.1.4.1.8.1 1.2l1.9 1v2.5l-1.9 1c0 .4-.1.8-.2 1.1L15 14l-2 2-1.9-1c-.3.2-.7.4-1.1.5L9.5 17h-3l-.5-1.5c-.4-.2-.8-.4-1.1-.6L3 16 1 14l1-1.9c-.1-.3-.2-.7-.2-1.1L0 10V7.5l1.8-.9c0-.4.1-.8.2-1.2L1 3.5l2-2 1.9 1c.3-.2.7-.4 1.1-.6L6.5 1z"/>
              </svg>
            </span>
            Settings
          </Link>
          <button
            className="user-menu__item"
            type="button"
            role="menuitem"
            onClick={handleLogout}
          >
            <span className="user-menu__icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6 2H2v12h4v1.5H.5V.5H6V2zm4.5 3.5l4 2.5-4 2.5V9H5V7h5.5V5.5z"/>
              </svg>
            </span>
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
