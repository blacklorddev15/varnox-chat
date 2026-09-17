import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getSuspension } from '@/lib/db';
import { getBot } from '@/lib/bots';
import { ensureSchema } from '@/lib/migrate';
import { BotThreadView } from '@/components/bot-thread';
import { SuspendedScreen } from '@/components/suspended-screen';

export const dynamic = 'force-dynamic';

/**
 * The conversation with one bot.
 *
 * Gated exactly like /bots and /bots/father: reconcile the schema, resolve the session, check
 * suspension. The bot is looked up scoped by owner, so an id belonging to somebody else is `notFound`
 * rather than a 403 — the same rule the API follows, and for the same reason: a distinct "exists but
 * not yours" turns ids into something worth guessing.
 *
 * The bot record is read here so the header can be drawn on the first paint. The messages are not:
 * they are rendered with locale-formatted times, and the server's locale is not the browser's, so
 * fetching them in the browser avoids a hydration mismatch — the same reasoning the Bots screen
 * documents at length.
 */
export const metadata: Metadata = {
  title: 'Bot chat',
  description: 'A conversation with one of your Varnox bots.',
  robots: { index: false, follow: false },
};

export default async function BotChatPage({ params }: { params: Promise<{ id: string }> }) {
  await ensureSchema();

  const me = await currentUser();
  if (!me) redirect('/login');

  const suspension = await getSuspension(me.id);
  if (suspension) return <SuspendedScreen suspension={suspension} />;

  const { id } = await params;
  const bot = await getBot(me.id, id);
  if (!bot) notFound();

  return <BotThreadView bot={bot} />;
}
