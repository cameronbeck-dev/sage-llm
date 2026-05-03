import type { SageState } from '../../hooks/useSageState';

interface SageAvatarProps {
  state?: SageState;
}

export default function SageAvatar({ state = 'idle' }: SageAvatarProps) {
  return (
    <div
      className={`sage-avatar-sprite sage-avatar-sprite--${state}`}
      aria-label={`Sage is ${state}`}
      role="img"
    >
      <div className="sage-avatar-sprite__face">
        <div className="sage-avatar-sprite__eyes">
          <span className="sage-avatar-sprite__eye" />
          <span className="sage-avatar-sprite__eye" />
        </div>
        <div className={`sage-avatar-sprite__mouth sage-avatar-sprite__mouth--${state}`} />
      </div>
    </div>
  );
}