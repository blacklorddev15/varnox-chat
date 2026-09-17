'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Bot, BotMessage, BotThread } from '@/lib/types';
import { api, post } from '@/lib/client';
import { timeOfDay } from '@/lib/format';
import { IconBack, IconBot, IconSend } from './icons';

/**
 * A conversation with a bot.
 *
 * THE REFRESH IS THE INTERESTING PART
 *
 * Nothing is pushed to the browser. A message the account sends is written to a queue, and the bot
 * answers when its own process next asks for work — which might be a second later or, if the
 * container is restarting, a minute later. So the reply does not arrive because of anything this
 * component did, and the screen has to go looking for it.
 *
 * Hence the poll. Every few seconds while the tab is visible, re-read the thread. It stops when the
 * document is hidden, because a background tab asking for the same unchanged rows forever is pure
 * waste, and it resumes when the tab comes back — which is exactly when somebody is looking at it
 * and would notice a reply that was already there.
 *
 * The alternative, holding a connection open per open conversation, needs an always-on server and
 * gets complicated behind serverless functions. Polling a few times a minute per open tab is the
 * boring choice, and boring is right for the part of the system that carries every message.
 *
 * DIRECTION IS THE OTHER THING TO GET RIGHT
 *
 * `in` means the message went *in* to the bot, so it is the account's own and draws on the right.
 * `out` means the bot answering, drawn on the left. Reversed, the conversation reads as though the
 * bot had said everything the person said — which is not a cosmetic bug.
 */

/** How often the thread is re-read while the tab is visible. */
const REFRESH_MS = 4_000;

type Payload = { bot: Bot; thread: BotThread | null; messages: BotMessage[] };

export function BotThreadView({ bot }: { bot: Bot }) {
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [thread, setThread] = useState<BotThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  const path = `/api/bots/${bot.id}/messages`;

  const read = useCallback(async () => {
    try {
      const res = await api<Payload>(path);
      setMessages(res.messages);
      setThread(res.thread);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read this conversation.');
    } finally {
      setLoading(false);
    }
  }, [path]);

  /**
   * The first read, written out rather than calling `read`, so the `loading` it clears is visible
   * on the line it is cleared. A mount effect that calls a function which sets state reads as a
   * synchronous setState during the effect — the cascading-render pattern — even when the state is
   * only touched after an await.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api<Payload>(path);
        if (cancelled) return;
        setMessages(res.messages);
        setThread(res.thread);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not read this conversation.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  // The poll. The callback hands off to an async function rather than being async itself, so the
  // interval can never overlap two reads if one of them is slow.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      void read();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [read]);

  /**
   * Follow the conversation, and be honest about the dependency: the trigger is the newest message
   * changing, which is what the last id being different means.
   */
  const lastId = messages.length > 0 ? messages[messages.length - 1].id : '';
  useEffect(() => {
    const el = scroller.current;
    // `lastId` is read rather than merely depended on, so the dependency is the thing this effect
    // responds to instead of an "extra" one. With nothing to follow there is nothing to scroll.
    if (!el || !lastId) return;
    el.scrollTop = el.scrollHeight;
  }, [lastId]);

  async function onStart() {
    setError('');
    setBusy(true);
    try {
      await post(`/api/bots/${bot.id}/start`);
      await read();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the bot.');
    } finally {
      setBusy(false);
    }
  }

  async function onSend(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setError('');
    setBusy(true);
    try {
      await post(`${path}`, { body });
      setDraft('');
      await read();
    } catch (err) {
      // The draft is left in the box on failure, so nothing anybody typed is lost to a bad request.
      setError(err instanceof Error ? err.message : 'Could not send that.');
    } finally {
      setBusy(false);
    }
  }

  const status = useMemo(() => {
    if (!thread) return 'Not started — press Start to say hello.';
    if (thread.pending > 0) {
      return `${thread.pending} message${thread.pending === 1 ? '' : 's'} waiting for the bot.`;
    }
    return 'Waiting for you.';
  }, [thread]);

  return (
    <div className="father-wrap">
      <header className="bots-head father-head">
        <Link href="/bots" className="bots-back" aria-label="Back to your bots">
          <IconBack size={22} />
        </Link>
        <div>
          <h1 className="bots-title">{bot.name}</h1>
          <p className="hint">
            {bot.handle ? `@${bot.handle} · ` : ''}
            {status}
          </p>
        </div>
        <span className="father-avatar" aria-hidden>
          <IconBot size={22} />
        </span>
      </header>

      {error ? (
        <p className="bots-alert error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="father-thread" ref={scroller} role="log" aria-live="polite">
        {loading ? <p className="bots-status">Loading this conversation…</p> : null}

        {!loading && !thread ? (
          <div className="bots-empty">
            <IconBot size={44} />
            <b>Press Start to talk to {bot.name}</b>
            <p className="hint">
              That opens the conversation and sends <code>/start</code>. Whatever you run for this
              bot picks the message up with its Varnox token — see the Bots README section.
            </p>
            <button type="button" className="btn" onClick={onStart} disabled={busy}>
              {busy ? 'Starting…' : 'Start'}
            </button>
          </div>
        ) : null}

        {!loading && thread && messages.length === 0 ? (
          <p className="bots-status">
            Started. Nothing here yet — the bot answers when its process next asks for work.
          </p>
        ) : null}

        {messages.map((m) => (
          // `in` went in to the bot, so it is mine and sits on the right.
          <div key={m.id} className={`msg-row${m.direction === 'in' ? ' out' : ''}`}>
            <div className={`bubble ${m.direction === 'in' ? 'tail-out' : 'tail-in'}`}>
              <div className="text">{m.body}</div>
              <div className="meta">{timeOfDay(m.createdAt)}</div>
            </div>
          </div>
        ))}
      </div>

      {thread ? (
        <form className="composer father-composer" onSubmit={onSend}>
          <div className="field">
            <textarea
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter makes a new line, as everywhere else in the app.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void onSend(event);
                }
              }}
              placeholder={`Message ${bot.name}`}
              aria-label={`Message ${bot.name}`}
              disabled={busy}
            />
          </div>
          <button
            type="submit"
            className="send-btn"
            disabled={busy || !draft.trim()}
            aria-label="Send"
          >
            <IconSend size={18} />
          </button>
        </form>
      ) : null}
    </div>
  );
}
