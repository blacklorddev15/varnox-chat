import { requireUser } from '@/lib/auth';
import { handle, ok, readJsonBody } from '@/lib/api';
import { getSettings, patchSettings } from '@/lib/db';
import type { ChatPrefs, PrivacyWho, UserSettings, WallpaperId } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    return ok({ settings: await getSettings(me.id) });
  });
}

type Body = {
  wallpaper?: WallpaperId;
  notifications?: boolean;
  privacy?: { lastSeen?: PrivacyWho; profilePhoto?: PrivacyWho; readReceipts?: boolean };
  chatPrefs?: Record<string, ChatPrefs>;
  blocked?: string[];
};

const WALLS: WallpaperId[] = ['doodle', 'plain', 'dots', 'grid', 'leaf'];
const WHO: PrivacyWho[] = ['everyone', 'contacts', 'nobody'];
const PREF_KEYS: (keyof ChatPrefs)[] = ['pinned', 'muted', 'archived'];

/** Keep only known flags, defensively bounded so one request cannot bloat the record. */
function cleanChatPrefs(input: Record<string, ChatPrefs>): Record<string, ChatPrefs> {
  const out: Record<string, ChatPrefs> = {};
  for (const [convId, raw] of Object.entries(input).slice(0, 300)) {
    if (!convId || typeof raw !== 'object' || raw === null) continue;
    const pref: ChatPrefs = {};
    for (const key of PREF_KEYS) {
      if (typeof (raw as ChatPrefs)[key] === 'boolean') pref[key] = (raw as ChatPrefs)[key];
    }
    out[convId] = pref;
  }
  return out;
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const body = await readJsonBody<Body>(req);
    const patch: Partial<Omit<UserSettings, 'userId'>> = {};

    if (body.wallpaper && WALLS.includes(body.wallpaper)) patch.wallpaper = body.wallpaper;
    if (typeof body.notifications === 'boolean') patch.notifications = body.notifications;

    if (body.privacy) {
      const privacy = { ...(await getSettings(me.id)).privacy };
      if (body.privacy.lastSeen && WHO.includes(body.privacy.lastSeen)) {
        privacy.lastSeen = body.privacy.lastSeen;
      }
      if (body.privacy.profilePhoto && WHO.includes(body.privacy.profilePhoto)) {
        privacy.profilePhoto = body.privacy.profilePhoto;
      }
      if (typeof body.privacy.readReceipts === 'boolean') {
        privacy.readReceipts = body.privacy.readReceipts;
      }
      patch.privacy = privacy;
    }

    // The client sends the whole map, so replacing it wholesale is what it expects.
    if (body.chatPrefs && typeof body.chatPrefs === 'object') {
      patch.chatPrefs = cleanChatPrefs(body.chatPrefs);
    }

    if (Array.isArray(body.blocked)) {
      patch.blocked = Array.from(
        new Set(body.blocked.filter((id) => typeof id === 'string' && id).slice(0, 200))
      );
    }

    const settings = await patchSettings(me.id, patch);
    return ok({ settings });
  });
}
