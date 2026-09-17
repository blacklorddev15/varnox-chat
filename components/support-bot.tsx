'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Bot, CreatedBot, PublicUser } from '@/lib/types';
import { api, del as remove, post } from '@/lib/client';
import { describeHandleProblem, suggestHandle } from '@/lib/bot-handle';
import { dateStamp } from '@/lib/format';
import { IconBack, IconBot, IconCopy, IconSend } from './icons';

/**
 * The Varnox Support Bot.
 *
 * Modelled on Telegram's BotFather, which is not an API — it is a bot you have a conversation with,
 * and its whole interface is commands and replies. This is the same idea pointed at Varnox's own
 * bots: a chat where `/newbot` walks you through name, then username, then hands over the token.
 *
 * WHY THIS IS BETTER THAN A TELEGRAM BOT DOING IT
 *
 * The signed-in session is the account link. Anybody in Telegram could press START on a bot, but
 * only somebody already signed in to this account can open this page — so there is no way to
 * reach the credential-minting code without owning the account it mints for. The alternative, a
 * Telegram-side bot, would have needed its own account-linking step and would have put a public
 * "make me a token" surface on the internet.
 *
 * WHAT THIS COMPONENT IS AND IS NOT
 *
 * It is a conversation and nothing else. Every action goes through the same /api/bots routes the
 * Bots screen uses, which do the auth, validation, rate limiting and minting. There is no second
 * implementation of any of that here — the command you type is turned into a request, and the
 * reply is whatever the server said. That is why session state lives in React state and not
 * anywhere else: the server is the record, and this is just the view of it.
 */

/** A button drawn under a reply. A descriptor rather than a closure, so state holds no functions. */
type ReplyButton = {
  label: string;
  action: Action;
  arg?: string;
  danger?: boolean;
};

type Action =
  | 'newbot'
  | 'mybots'
  | 'deletebot'
  | 'help'
  | 'cancel'
  | 'pick-bot'
  | 'test'
  | 'revoke'
  | 'ask-delete'
  | 'confirm-delete';

type Line = {
  id: number;
  from: 'father' | 'you';
  text: string;
  /** Rendered as the once-only token block. Only ever set on the reply to a successful create. */
  token?: string;
  buttons?: ReplyButton[];
  at: number;
};

/**
 * Where the conversation is.
 *
 * A discriminated union rather than a string plus a bag of fields, so a step cannot be entered
 * without the answers it needs — `awaiting-username` cannot exist without a name. The compiler
 * enforces the order of the wizard, which is the part of this component most likely to be broken
 * by a later edit.
 */
type Flow =
  | { kind: 'idle' }
  | { kind: 'awaiting-name' }
  | { kind: 'awaiting-username'; name: string }
  | { kind: 'awaiting-telegram'; name: string; handle: string }
  | { kind: 'confirm-delete'; botId: string; botName: string };

const HELP = [
  'Commands:',
  '/newbot — create a new bot',
  '/mybots — list, test, revoke or delete your bots',
  '/deletebot — delete a bot',
  '/cancel — stop what you are doing',
].join('\n');

function greeting(username: string): string {
  return [
    `I'm the Varnox Support Bot. I create and manage the bots on @${username}.`,
    '',
    HELP,
  ].join('\n');
}

/** The status line under a bot's name in a card or a picker. */
function describeBot(bot: Bot): string {
  const live = bot.tokenIssuedAt !== null && bot.tokenRevokedAt === null;
  const parts = [
    bot.active ? 'Active' : 'Inactive',
    bot.hasTelegram ? `Telegram: ${bot.telegramUsername ? `@${bot.telegramUsername}` : 'linked'}` : 'No Telegram token',
    live ? 'Token live' : bot.tokenRevokedAt ? 'Token revoked' : 'No token',
  ];
  return `${parts.join(' · ')}\nCreated ${dateStamp(bot.createdAt)}`;
}

export function SupportBot({ me }: { me: PublicUser }) {
  const [lines, setLines] = useState<Line[]>(() => [
    { id: 0, from: 'father', text: greeting(me.username), at: 0 },
  ]);
  const [flow, setFlow] = useState<Flow>({ kind: 'idle' });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /** Known bots, cached from the last list so a card can be redrawn without a round trip. */
  const [known, setKnown] = useState<Bot[]>([]);

  const nextId = useRef(1);
  const thread = useRef<HTMLDivElement>(null);

  const say = useCallback((text: string, extra: Partial<Line> = {}) => {
    setLines((prev) => [
      ...prev,
      { id: nextId.current++, from: 'father', text, at: Date.now(), ...extra },
    ]);
  }, []);

  const hear = useCallback((text: string) => {
    setLines((prev) => [...prev, { id: nextId.current++, from: 'you', text, at: Date.now() }]);
  }, []);

  /**
   * Follow the conversation. A DOM write rather than a state change, so it does not schedule a
   * render of its own.
   *
   * The count is read on the next line so the dependency is the thing this effect actually
   * responds to. Without a read, `lines` is an "extra" dependency and the linter is right to say
   * so — but the trigger really is a message being added, which is precisely what the count
   * changing means. Reading it makes the intent visible instead of suppressed.
   */
  const lineCount = lines.length;
  useEffect(() => {
    const el = thread.current;
    if (!el || lineCount === 0) return;
    el.scrollTop = el.scrollHeight;
  }, [lineCount]);

  /** Carry out a button press. */
  const runAction = useCallback(
    (action: Action, arg?: string) => {
      // One action at a time. A double-press while a request is in flight would create two bots.
      if (busy) return;
      void (async () => {
        switch (action) {
          case 'help':
            say(HELP);
            return;
          case 'cancel':
            setFlow({ kind: 'idle' });
            say('Cancelled. Send /newbot to start again.');
            return;
          case 'newbot':
            setFlow({ kind: 'awaiting-name' });
            say('Alright, a new bot. What shall we call it?\n\nSend me a name — anything you like.');
            return;
          case 'mybots':
          case 'deletebot': {
            setBusy(true);
            try {
              const res = await api<{ bots: Bot[] }>('/api/bots');
              setKnown(res.bots);
              if (res.bots.length === 0) {
                setFlow({ kind: 'idle' });
                say('You have no bots yet. Send /newbot to create one.');
                return;
              }
              setFlow({ kind: 'idle' });
              say(
                action === 'deletebot'
                  ? 'Which one should I delete? This cannot be undone.'
                  : `You have ${res.bots.length} bot${res.bots.length === 1 ? '' : 's'}. Choose one.`,
                {
                  buttons: res.bots.map((bot) => ({
                    label: `@${bot.handle ?? bot.name}`,
                    action: action === 'deletebot' ? ('ask-delete' as const) : ('pick-bot' as const),
                    arg: bot.id,
                    danger: action === 'deletebot',
                  })),
                }
              );
            } catch (err) {
              say(err instanceof Error ? err.message : 'I could not read your bots.');
            } finally {
              setBusy(false);
            }
            return;
          }
          case 'pick-bot':
          case 'ask-delete': {
            const bot = known.find((b) => b.id === arg);
            if (!bot) {
              say('That bot is no longer in the list. Send /mybots again.');
              return;
            }
            if (action === 'ask-delete') {
              setFlow({ kind: 'confirm-delete', botId: bot.id, botName: bot.handle ?? bot.name });
              say(`Delete @${bot.handle ?? bot.name}? Its tokens go with it, and none of it can be recovered.`, {
                buttons: [
                  { label: 'Yes, delete it', action: 'confirm-delete', arg: bot.id, danger: true },
                  { label: 'Cancel', action: 'cancel' },
                ],
              });
              return;
            }
            say(`@${bot.handle ?? bot.name}\n${bot.name}\n\n${describeBot(bot)}`, {
              buttons: [
                { label: 'Test Telegram', action: 'test', arg: bot.id },
                { label: 'Revoke token', action: 'revoke', arg: bot.id },
                { label: 'Delete', action: 'ask-delete', arg: bot.id, danger: true },
                { label: 'Back to list', action: 'mybots' },
              ],
            });
            return;
          }
          case 'test': {
            setBusy(true);
            try {
              const res = await post<{ bot: { id: string; username: string; firstName: string } }>(
                `/api/bots/${arg}/telegram/test`
              );
              const who = res.bot.username ? `@${res.bot.username}` : res.bot.firstName || 'your bot';
              say(`Telegram answered. That token belongs to ${who} (id ${res.bot.id}).`);
            } catch (err) {
              say(err instanceof Error ? err.message : 'The Telegram test failed.');
            } finally {
              setBusy(false);
            }
            return;
          }
          case 'revoke': {
            setBusy(true);
            try {
              const res = await post<{ revoked: boolean }>(`/api/bots/${arg}/revoke-token`);
              say(
                res.revoked
                  ? 'Token revoked. It will not authenticate again, and I cannot give you a new one for this bot — delete it and create another if you need one.'
                  : 'That bot had no live token to revoke.'
              );
            } catch (err) {
              say(err instanceof Error ? err.message : 'I could not revoke that token.');
            } finally {
              setBusy(false);
            }
            return;
          }
          case 'confirm-delete': {
            const name = flow.kind === 'confirm-delete' ? flow.botName : 'that bot';
            setBusy(true);
            try {
              await remove(`/api/bots/${arg}`);
              setKnown((prev) => prev.filter((b) => b.id !== arg));
              setFlow({ kind: 'idle' });
              say(`Deleted @${name}. It is gone, along with its tokens.`);
            } catch (err) {
              say(err instanceof Error ? err.message : 'I could not delete that bot.');
            } finally {
              setBusy(false);
            }
            return;
          }
        }
      })();
    },
    [busy, flow, known, say]
  );

  /** Create the bot the conversation has been building. */
  const create = useCallback(
    async (name: string, handle: string, telegramToken: string) => {
      setBusy(true);
      try {
        const created = await post<CreatedBot>('/api/bots', {
          name,
          handle,
          // Omitted rather than sent empty, so the route's optional rule sees an absent key.
          telegramToken: telegramToken || undefined,
        });
        setKnown((prev) => [created.bot, ...prev]);
        setFlow({ kind: 'idle' });
        say(`Done! @${created.bot.handle ?? handle} is yours.`, {
          token: created.token,
          buttons: [
            { label: 'My bots', action: 'mybots' },
            { label: 'Create another', action: 'newbot' },
          ],
        });
        say(
          'That is the only time I will show that token — I kept a hash, not the token itself. Copy it now.'
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'I could not create the bot.';
        /**
         * A taken username is fixed by choosing another, so the conversation goes back to the
         * username step rather than leaving the problem under a step that cannot solve it.
         */
        if (/username is already taken/i.test(message)) {
          setFlow({ kind: 'awaiting-username', name });
          say(`${message}\n\nSend me another username.`);
        } else {
          say(message);
        }
      } finally {
        setBusy(false);
      }
    },
    [say]
  );

  /** Take one turn: either an answer to the current step, or a command. */
  const submit = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setDraft('');
      hear(text);

      const word = text.toLowerCase().replace(/^\//, '').split(/\s+/)[0];

      // A command always wins over the current step, so /cancel and /help work mid-conversation.
      if (['newbot', 'mybots', 'deletebot', 'help', 'start'].includes(word)) {
        if (word === 'start' || word === 'help') {
          runAction('help');
          return;
        }
        runAction(word as Action);
        return;
      }
      if (word === 'cancel') {
        runAction('cancel');
        return;
      }

      switch (flow.kind) {
        case 'awaiting-name': {
          if (text.length > 80) {
            say('That is a little long. Keep the name to 80 characters or fewer.');
            return;
          }
          const suggested = suggestHandle(text);
          setFlow({ kind: 'awaiting-username', name: text });
          say(
            `Good. Now choose a username for @${text}.\n\n` +
              (suggested
                ? `How about @${suggested}? Send it back to accept it, or type your own.`
                : 'Send me a username.') +
              '\n\nLowercase letters, digits, - and _, ending in -bot or _bot, 5–32 characters. It cannot be changed later.'
          );
          return;
        }
        case 'awaiting-username': {
          const problem = describeHandleProblem(text);
          if (problem) {
            say(`${problem}\n\nTry another.`);
            return;
          }
          setFlow({ kind: 'awaiting-telegram', name: flow.name, handle: text.toLowerCase() });
          say(
            'Last thing: a Telegram bot token, if this bot should answer on Telegram.\n\n' +
              'Paste one from @BotFather, or send /skip to leave it out and add it later.'
          );
          return;
        }
        case 'awaiting-telegram': {
          if (word === 'skip') {
            void create(flow.name, flow.handle, '');
            return;
          }
          void create(flow.name, flow.handle, text);
          return;
        }
        default:
          say(`I did not understand that. ${HELP}`);
      }
    },
    [busy, create, flow, hear, runAction, say]
  );

  const chips = useMemo(
    () => [
      { label: '/newbot', action: 'newbot' as const },
      { label: '/mybots', action: 'mybots' as const },
      { label: '/deletebot', action: 'deletebot' as const },
      { label: '/help', action: 'help' as const },
    ],
    []
  );

  return (
    <div className="father-wrap">
      <header className="bots-head father-head">
        <Link href="/bots" className="bots-back" aria-label="Back to your bots">
          <IconBack size={22} />
        </Link>
        <div>
          <h1 className="bots-title">Varnox Support Bot</h1>
          <p className="hint">Create and manage your bots by talking to it.</p>
        </div>
        <span className="father-avatar" aria-hidden>
          <IconBot size={22} />
        </span>
      </header>

      <div className="father-thread" ref={thread} role="log" aria-live="polite">
        {lines.map((line) => (
          <div key={line.id} className={`msg-row${line.from === 'you' ? ' out' : ''}`}>
            <div className={`bubble ${line.from === 'you' ? 'tail-out' : 'tail-in'}`}>
              <div className="text">{line.text}</div>

              {/*
                The token, drawn once. It lives in this line and nowhere else — leaving the page
                loses it, which is the point rather than an oversight.
              */}
              {line.token ? (
                <div className="father-token">
                  <code className="bots-token">{line.token}</code>
                  <button
                    type="button"
                    className="father-btn"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(line.token ?? '')
                        .then(() => say('Copied to the clipboard.'))
                        .catch(() =>
                          say('I could not copy it. Select the token above and copy it by hand.')
                        );
                    }}
                  >
                    <IconCopy size={15} /> Copy token
                  </button>
                </div>
              ) : null}

              {line.buttons?.length ? (
                <div className="father-btns">
                  {line.buttons.map((button) => (
                    <button
                      key={`${button.action}:${button.arg ?? ''}`}
                      type="button"
                      className={`father-btn${button.danger ? ' danger' : ''}`}
                      disabled={busy}
                      onClick={() => runAction(button.action, button.arg)}
                    >
                      {button.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {line.at ? (
                <div className="meta">
                  {new Date(line.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="msg-row">
            <div className="bubble tail-in">
              <div className="text father-typing">…</div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="father-chips">
        {chips.map((chip) => (
          <button
            key={chip.action}
            type="button"
            className="father-chip"
            disabled={busy}
            onClick={() => runAction(chip.action)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <form
        className="composer father-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <div className="field">
          <textarea
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(event) => {
              // Enter sends and Shift+Enter makes a new line, as everywhere else in the app.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit(draft);
              }
            }}
            placeholder={flow.kind === 'idle' ? 'Send a command, or /newbot' : 'Type your answer'}
            aria-label="Message the Varnox Support Bot"
            disabled={busy}
          />
        </div>
        <button type="submit" className="send-btn" disabled={busy || !draft.trim()} aria-label="Send">
          <IconSend size={18} />
        </button>
      </form>
    </div>
  );
}
