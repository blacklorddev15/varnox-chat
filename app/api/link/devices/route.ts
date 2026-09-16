import { currentDeviceId, requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { listDevices, touchDevice } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/link/devices — every device still signed in to this account.
 *
 * Opening the list is a sign of life for the device doing the asking, so its last seen is
 * updated here instead of on a heartbeat nobody would look at. `current` is worked out from
 * the session cookie, which the datastore cannot see.
 */
export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    const current = await currentDeviceId();
    if (current) await touchDevice(current);

    const devices = await listDevices(me.id);
    return ok({ devices: devices.map((device) => ({ ...device, current: device.id === current })) });
  });
}
