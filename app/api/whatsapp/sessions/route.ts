import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';
import { listWhatsAppSessions } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * The WhatsApp numbers linked to this account.
 *
 * Attribution is derived from the pairing requests this user made, because the bot that writes
 * varnox_sessions does not record a user id — see listWhatsAppSessions.
 */
export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    return ok({ sessions: await listWhatsAppSessions(me.id) });
  });
}
