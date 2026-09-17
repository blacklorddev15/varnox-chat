export function timeOfDay(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yest)) return 'Yesterday';
  const withinWeek = (today.getTime() - d.getTime()) / 86_400_000 < 7;
  if (withinWeek) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export function listStamp(at: number): string {
  const d = new Date(at);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return timeOfDay(at);
  const diff = (now.getTime() - at) / 86_400_000;
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/**
 * Short "how long ago" stamp for the updates tab: an update is only interesting for the
 * 24 hours it lives, so minutes and hours carry all the information a row needs.
 */
export function relativeTime(at: number): string {
  const diff = Date.now() - at;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
  return new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function presence(lastSeen: number): string {
  if (!lastSeen) return 'offline';
  const diff = Date.now() - lastSeen;
  if (diff < 60_000) return 'online';
  if (diff < 3_600_000) return `last seen ${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `last seen ${Math.round(diff / 3_600_000)} h ago`;
  return `last seen ${new Date(lastSeen).toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}

const AVATAR_COLORS = [
  '#7C5CFF',
  '#F0568A',
  '#12A594',
  '#F5A524',
  '#2E90FA',
  '#A855F7',
  '#EF4444',
  '#0EA5E9',
  '#84CC16',
];

export function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 100000;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function shortPreview(text: string, max = 64): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/**
 * A full calendar date, for a fact about *when* something happened.
 *
 * Distinct from listStamp, which trades precision for brevity because it labels a chat that the
 * reader already has context for. A bot's creation date is read once, by somebody checking which
 * of two similar bots is the new one, so the year is worth its width.
 */
export function dateStamp(at: number): string {
  return new Date(at).toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
