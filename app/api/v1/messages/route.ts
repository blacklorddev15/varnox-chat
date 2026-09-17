import { bad, handle, ok, readJsonBody } from '@/lib/api';
import { authenticateRequest } from '@/lib/bot-auth';
import { sendBotMessage } from '@/lib/db';
import { str, validate } from '@/lib/validate';

export const dynamic = 'force-dynamic';

/**
 * Queue a message, as the token's owner, to one of their paired numbers.
 *
 * The same operation POST /api/bot performs for a signed-in browser, reached with a token instead
 * of a cookie. Nothing is sent from here: the message is written to varnox_bot_inbound and the
 * bot's bridge helper on the host picks it up — the arrangement the app's own route documents, and
 * the reason there is no inbound surface for the bot host to reach.
 *
 * The body is validated rather than cleaned. `clean` truncates, which is right for a value being
 * squeezed into a field, but a message is content: a caller that sends 5,000 characters should be
 * told the limit, not have the message quietly cut in half and delivered. Newlines are preserved
 * for the same reason — a multi-line message is a message.
 */
const SendSchema = {
  session: str({ label: 'Session', min: 1, max: 80 }),
  body: str({ label: 'Message', min: 1, max: 4000 }),
};

export async function POST(req: Request) {
  return handle(async () => {
    const auth = await authenticateRequest(req);
    if (!auth.ok) return auth.response;

    const input = validate(SendSchema, await readJsonBody<unknown>(req));

    // Null covers "no such number" and "not this account's number" alike, so a caller cannot use
    // the difference to discover which session ids exist.
    const sent = await sendBotMessage(auth.ownerId, input.session, input.body);
    if (!sent) return bad('That number is not linked to this account', 404);

    return ok(
      {
        message: sent,
        note: 'Queued for the paired number. Delivery is the bot bridge\'s job, not this response\'s.',
      },
      201
    );
  });
}
