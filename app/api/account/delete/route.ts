import { clearSessionCookie, requireUser } from '@/lib/auth';
import { bad, clean, handle, ok, readJsonBody } from '@/lib/api';
import { deleteAccount } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Delete the account.
 *
 * Confirmed by typing the handle rather than by tapping twice, because this is irreversible from
 * the app and takes the account's whole history out of reach. The check is the database's —
 * `deleteAccount` refuses unless the string matches — so a client that skips the prompt gains
 * nothing.
 *
 * Soft: the row stays and messages stay in the threads they were sent to. They are not only
 * this account's to remove, and erasing them would reach into everybody else's copy of the
 * conversation.
 *
 * What goes away, then, is decided at the places that read the row rather than here — this route
 * only writes the flag:
 *
 *   signing in      currentUser() refuses a deleted account, so every route behind it closes
 *   search          searchUsers filters on deleted_at
 *   the directory   listUsers filters on deleted_at, which it previously did not — the panel
 *                   opens on that list, so clearing the search box brought the account back
 *   group rosters   presentMember keeps the profile, so buildChatRow drops a deleted account
 *                   from a group's members, count and admins rather than leaving a name there
 *                   that resolves to nobody
 *   new contact     POST /api/chats refuses a direct chat with a deleted account by name, and
 *                   neither creating nor extending a group will accept one
 *   sending         a one-to-one thread that already exists stays readable, but POST to its
 *                   messages refuses with the same words — otherwise opening an existing thread
 *                   would be the way around the check above
 *   people lists    the updates feed, the viewers of an update, and a channel's followers
 *
 * A one-to-one thread itself is left alone and still shows the other person's name: the history
 * is theirs too, and relabelling the conversation "Chat" would hide which one it is.
 */
type Body = { username?: string };

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const body = await readJsonBody<Body>(req);
    const typed = clean(body.username, 40);
    if (!typed) return bad('Type your username to confirm');

    const done = await deleteAccount(me.id, typed);
    // One answer for "wrong username" and "already deleted", so neither can be probed.
    if (!done) return bad('That does not match your username', 403);

    // Signing out is not a courtesy. The cookie is still cryptographically valid, and leaving it
    // would keep somebody signed in to an account they have just deleted.
    await clearSessionCookie();
    return ok({ deleted: true });
  });
}
