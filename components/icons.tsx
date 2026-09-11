type P = { size?: number; className?: string };

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function IconLogo({ size = 34, className }: P) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={className} aria-hidden>
      <defs>
        <linearGradient id="vx-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#19C08E" />
          <stop offset="1" stopColor="#0B7D5E" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="46" height="46" rx="13" fill="url(#vx-g)" />
      <path d="M11.5 14h5l7.5 13.2L31.5 14h5l-10 19.6h-6z" fill="#fff" />
      <circle cx="37.5" cy="33.5" r="4.6" fill="#04352a" opacity="0.35" />
    </svg>
  );
}

export function IconChat({ size = 22, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.6 9.6 0 0 1-2.9-.4L4 21l1.4-4.2A8.3 8.3 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z" />
    </svg>
  );
}

export function IconNewChat({ size = 22, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="M20 11.5a8 8 0 0 1-8.5 8 9 9 0 0 1-2.7-.4L4 20.5l1.3-4A8 8 0 0 1 3.5 11.5a8 8 0 0 1 8.5-8 8 8 0 0 1 8 8Z" />
      <path d="M12 8.5v6M9 11.5h6" />
    </svg>
  );
}

export function IconGroup({ size = 22, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20" />
      <circle cx="9.5" cy="7.5" r="3.2" />
      <path d="M17 11.2a3.2 3.2 0 0 0 0-6.3M21 20v-1.5a4 4 0 0 0-3-3.8" />
    </svg>
  );
}

export function IconSearch({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.7-3.7" />
    </svg>
  );
}

export function IconSend({ size = 22, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor">
      <path d="M3.5 20.2 21 12 3.5 3.8 3.5 10l12 2-12 2z" />
    </svg>
  );
}

export function IconEmoji({ size = 22, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14.2a4.4 4.4 0 0 0 7 0" />
      <path d="M9 9.8h.01M15 9.8h.01" />
    </svg>
  );
}

export function IconSmilePlus({ size = 22, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="M20.5 11.2A8.6 8.6 0 1 1 12.8 2.6" />
      <path d="M8.6 13.8a4.6 4.6 0 0 0 6.8 0" />
      <path d="M9 9.4h.01M15 9.4h.01" />
      <path d="M18 2.4v5M15.5 4.9h5" />
    </svg>
  );
}

export function IconAttach({ size = 22, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="M20 12.5 12.6 20a4.6 4.6 0 0 1-6.5-6.5l7.7-7.7a3 3 0 0 1 4.3 4.3l-7.6 7.6a1.5 1.5 0 0 1-2.1-2.1l6.6-6.6" />
    </svg>
  );
}

export function IconCamera({ size = 22, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="M3 8.6A2.6 2.6 0 0 1 5.6 6h1.6l1.3-2h6.9l1.3 2h1.7A2.6 2.6 0 0 1 21 8.6v8.8A2.6 2.6 0 0 1 18.4 20H5.6A2.6 2.6 0 0 1 3 17.4Z" />
      <circle cx="12" cy="13" r="3.6" />
    </svg>
  );
}

export function IconMic({ size = 22, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5M8.5 21.5h7" />
    </svg>
  );
}

export function IconPlay({ size = 18, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor">
      <path d="M7 4.5 19 12 7 19.5z" />
    </svg>
  );
}

export function IconPause({ size = 18, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor">
      <rect x="6.5" y="4.5" width="3.6" height="15" rx="1" />
      <rect x="13.9" y="4.5" width="3.6" height="15" rx="1" />
    </svg>
  );
}

export function IconClose({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconBack({ size = 22, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S} strokeWidth="2">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function IconChevron({ size = 18, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S} strokeWidth="2">
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function IconMenu({ size = 22, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

export function IconEdit({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="M4 20h4l10-10-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}

export function IconTrash({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </svg>
  );
}

export function IconExit({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 8l-4 4 4 4M6 12h9" />
    </svg>
  );
}

export function IconReply({ size = 18, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="M9 7 4 12l5 5" />
      <path d="M4 12h9a6 6 0 0 1 6 6v1" />
    </svg>
  );
}

export function IconForward({ size = 18, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="m15 7 5 5-5 5" />
      <path d="M20 12h-9a6 6 0 0 0-6 6v1" />
    </svg>
  );
}

export function IconCopy({ size = 18, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <rect x="9" y="9" width="11" height="11" rx="2.4" />
      <path d="M15 9V6.4A2.4 2.4 0 0 0 12.6 4H6.4A2.4 2.4 0 0 0 4 6.4v6.2A2.4 2.4 0 0 0 6.4 15H9" />
    </svg>
  );
}

export function IconStar({ size = 20, className, filled }: P & { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      {...S}
      fill={filled ? 'currentColor' : 'none'}
    >
      <path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
    </svg>
  );
}

export function IconPin({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="M9 4h6l-1 5 3.5 3.5H5.5L9 9z" />
      <path d="M12 12.5V20" />
    </svg>
  );
}

export function IconArchive({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <rect x="3" y="4.5" width="18" height="4.5" rx="1.4" />
      <path d="M4.5 9v9.4A1.6 1.6 0 0 0 6.1 20h11.8a1.6 1.6 0 0 0 1.6-1.6V9M10 13h4" />
    </svg>
  );
}

export function IconBell({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10.5 19a1.7 1.7 0 0 0 3 0" />
    </svg>
  );
}

export function IconBellOff({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="M8.6 4.6A6 6 0 0 1 18 9c0 5 2 6 2 6H8M6 9.6C6.2 6 8.7 4 12 4" />
      <path d="M5.4 15h.2M4 4l16 16M10.5 19a1.7 1.7 0 0 0 3 0" />
    </svg>
  );
}

export function IconInfo({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 11v5.4M12 7.9h.01" />
    </svg>
  );
}

export function IconLock({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

export function IconUser({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

export function IconPalette({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-.9 2-1.8s-.7-1.7-.7-2.5c0-.9.7-1.5 1.7-1.5h1.5a4 4 0 0 0 4-4c0-4-4-7.2-8.5-7.2Z" />
      <path d="M7.5 11h.01M10 7.6h.01M14.4 7.6h.01" />
    </svg>
  );
}

export function IconBlock({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="m6.4 6.4 11.2 11.2" />
    </svg>
  );
}

export function IconDoc({ size = 22, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="M6 3.5h7l5 5v12H6z" />
      <path d="M13 3.5v5h5M9 13h6M9 16.5h4" />
    </svg>
  );
}

export function IconImage({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.2" />
      <path d="m5 16.5 4.5-4.5 3.5 3.5 2.5-2.5 3.5 3.5" />
      <circle cx="9" cy="9.6" r="1.3" />
    </svg>
  );
}

export function IconClock({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.4V12l3.2 2" />
    </svg>
  );
}

export function IconLink({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="M10 13.6a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1 1" />
      <path d="M14 10.4a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1-1" />
    </svg>
  );
}

export function IconCheck({ size = 16, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S} strokeWidth="2.2">
      <path d="m5 12.5 4.2 4.2L19 7" />
    </svg>
  );
}

export function IconDoubleCheck({ size = 16, className }: P) {
  return (
    <svg viewBox="0 0 26 24" width={size * 1.3} height={size} className={className} {...S} strokeWidth="2.1">
      <path d="m2 12.5 4 4L15 7" />
      <path d="m11 16.5 2 2L24 7" />
    </svg>
  );
}

export function IconSettings({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 14.4a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-3-1.2l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0-1.2-2.9H2.7a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-3l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 2.9-1.2V2.7a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 3 1.2l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  );
}

export function IconMoon({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <path d="M20 14.5A8.2 8.2 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" />
    </svg>
  );
}

export function IconSun({ size = 20, className }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...S}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2M12 19.4v2M4.4 4.4l1.4 1.4M18.2 18.2l1.4 1.4M2.6 12h2M19.4 12h2M4.4 19.6l1.4-1.4M18.2 5.8l1.4-1.4" />
    </svg>
  );
}
