import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * The ICE servers the browser may use to find a route to the other side.
 *
 * Read from the environment so a deployment can start on public STUN and move to a relayed
 * TURN service without a code change — which matters, because STUN alone cannot connect two
 * devices behind symmetric NATs, and that is a fact about the network rather than the app.
 *
 * The TURN entry is only added when a URL is configured, so a deployment that has not set one
 * does not hand the browser a server it cannot reach. The username and credential are returned
 * to the signed-in user because that is how TURN authenticates — they are never logged.
 */
function urls(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function GET() {
  return handle(async () => {
    await requireUser();

    const stun = urls(process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302');
    const turn = urls(process.env.TURN_URLS);
    const username = process.env.TURN_USERNAME;
    const credential = process.env.TURN_CREDENTIAL;

    const iceServers: { urls: string[]; username?: string; credential?: string }[] = [];
    if (stun.length) iceServers.push({ urls: stun });
    if (turn.length) {
      iceServers.push({
        urls: turn,
        ...(username ? { username } : {}),
        ...(credential ? { credential } : {}),
      });
    }

    return ok({ iceServers });
  });
}
