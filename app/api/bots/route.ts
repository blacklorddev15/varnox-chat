import { requireUser } from '@/lib/auth';
import { bad, handle, ok, readJsonBody } from '@/lib/api';
import { botRateMessage, botRateSlot, createBot, handleTaken, listBots } from '@/lib/bots';
import { BOT_HANDLE_HINT, BOT_HANDLE_MAX, BOT_HANDLE_MIN, BOT_HANDLE_PATTERN } from '@/lib/bot-handle';
import { TELEGRAM_BOT_TOKEN_PATTERN } from '@/lib/bots-token';
import { secretKeyAvailable } from '@/lib/secretbox';
import { bool, optional, str, validate } from '@/lib/validate';

export const dynamic = 'force-dynamic';

/**
 * Varnox's own bots.
 *
 * Distinct from /api/bot (singular) next door, which is the message bridge to the operator's
 * WhatsApp bot. This route manages bots as objects — creating them, listing them, and issuing the
 * Varnox API token each one is called with. The two share a namespace and nothing else.
 *
 * Both handlers are `handle()`-wrapped, so both go through requireUser() and are scoped to the
 * signed-in account. There is no path here that answers without a session, and no query that
 * runs without the account id in it.
 */

/**
 * The body of a create request, declared rather than read.
 *
 * Every field the route will use is named here with its type, length and format, and validate()
 * builds its result by walking this object — so anything else in the request body is dropped
 * before a line of route code can see it. A caller who adds `user_id` or `token_hash` to the
 * JSON is not doing anything: those keys are not in this schema, so they do not survive.
 *
 * `active` is optional and defaults to true, which is what the form's initial state is — a bot
 * somebody just described should start enabled, and asking them to also confirm that would be a
 * second way to get it wrong.
 *
 * `telegramToken` is optional because a bot can be recorded before its Telegram side exists. Its
 * pattern is Telegram's own shape, with a hint that says where a token comes from: a mistyped
 * token is by far the most likely error here, and "copy it from @BotFather" is the fix.
 */
const CreateSchema = {
  name: str({ label: 'Bot name', min: 1, max: 80 }),
  /**
   * The Varnox handle, folded to lowercase before it is checked.
   *
   * `lowercase: true` rather than rejecting capitals. A handle is not a display name: nobody writes
   * "@Support-Bot" meaning something different from "@support-bot", and the database's uniqueness
   * is on lower(handle) regardless — so accepting the capitals and folding them is the behaviour
   * that matches what actually gets stored. Rejecting them would be pedantry that produces a
   * confusing error about characters that were never the problem.
   *
   * Folding has to happen *before* the pattern check, which is why it is a property of the field
   * rather than something done to the result afterwards.
   */
  handle: str({
    lowercase: true,
    label: 'Username',
    min: BOT_HANDLE_MIN,
    max: BOT_HANDLE_MAX,
    pattern: BOT_HANDLE_PATTERN,
    hint: BOT_HANDLE_HINT,
  }),
  description: optional(str({ label: 'Description', max: 500 })),
  active: optional(bool({ label: 'Active status' })),
  telegramToken: optional(
    str({
      label: 'Telegram bot token',
      max: 200,
      pattern: TELEGRAM_BOT_TOKEN_PATTERN,
      hint: 'A Telegram bot token looks like 123456789:AA… — copy it from @BotFather.',
    })
  ),
};

/** This account's bots, newest first. */
export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    return ok({ bots: await listBots(me.id) });
  });
}

/**
 * Create a bot and issue its first Varnox API token.
 *
 * The response is the only place the plaintext token is ever returned — 201 with the bot and the
 * token, once. Nothing stores it, so nothing can return it again; see lib/bots.ts for why a hash
 * is what goes into the row.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();

    // Parsed before the rate slot is spent, so a malformed request does not cost the caller one
    // of their creations. Validation is pure and cheap; the slot is not.
    const input = validate(CreateSchema, await readJsonBody<unknown>(req));

    /**
     * Storing a Telegram token requires a key to seal it with, and a missing key is a deployment
     * fault rather than a bad request — so it is answered 503 with the variable named, before a
     * rate slot is spent on a request that could not have succeeded.
     *
     * Only checked when a Telegram token was actually supplied: a bot with no Telegram side needs
     * no key, and refusing to create one because an unrelated variable is unset would break a
     * feature that has nothing to do with it.
     */
    if (input.telegramToken && !secretKeyAvailable()) {
      return bad(
        'TELEGRAM_TOKEN_KEY (or SESSION_SECRET) is not set on the server, so a Telegram bot token cannot be stored. Set one and retry.',
        503
      );
    }

    const slot = await botRateSlot(me.id, 'create');
    if (!slot.allowed) return bad(botRateMessage('create', slot.retryAfterMs), 429);

    /**
     * Checked after the rate slot is spent, so walking the namespace to find a free username costs
     * quota rather than being free.
     *
     * Advisory only. Two requests can pass this in the same instant and the unique index settles
     * which one wins — createBot turns that violation into the same sentence, so both paths reach
     * the caller as a 409 with the same wording. This check exists only so the ordinary case does
     * not have to rely on an exception to produce a usable message.
     */
    if (await handleTaken(input.handle)) {
      return bad('That username is already taken. Try another.', 409);
    }

    const created = await createBot(me.id, {
      name: input.name,
      handle: input.handle,
      description: input.description ?? '',
      active: input.active ?? true,
      telegramToken: input.telegramToken,
    });

    return ok(created, 201);
  });
}
