import { requireUser } from '@/lib/auth';
import { handle, ok, readJsonBody } from '@/lib/api';
import { getSettings, patchSettings } from '@/lib/db';
import type { PrivacyWho, UserSettings, WallpaperId } from '@/lib/types';

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
};

const WALLS: WallpaperId[] = ['doodle', 'plain', 'dots', 'grid', 'leaf'];
const WHO: PrivacyWho[] = ['everyone', 'contacts', 'nobody'];

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

    const settings = await patchSettings(me.id, patch);
    return ok({ settings });
  });
}
