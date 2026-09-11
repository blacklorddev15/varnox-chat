'use client';

import { colorFor, initials } from '@/lib/format';

export function Avatar({
  name,
  src,
  size = 49,
  online,
  ring,
}: {
  name: string;
  src?: string | null;
  size?: number;
  online?: boolean;
  ring?: boolean;
}) {
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, size * 0.36),
        background: src ? 'var(--panel-3)' : colorFor(name || '?'),
        boxShadow: ring ? '0 0 0 2px var(--panel), 0 0 0 4px var(--brand)' : undefined,
      }}
      title={name}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} loading="lazy" />
      ) : (
        initials(name)
      )}
      {online ? <span className="dot" /> : null}
    </div>
  );
}

export function GroupAvatar({
  name,
  src,
  size = 49,
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  return <Avatar name={name || 'Group'} src={src} size={size} />;
}
