'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Bot, BotThread, CreatedBot, PublicUser } from '@/lib/types';
import { api, del as remove, post } from '@/lib/client';
import { dateStamp, relativeTime } from '@/lib/format';
import { describeHandleProblem, suggestHandle } from '@/lib/bot-handle';
import {
  IconBack,
  IconBot,
  IconCheck,
  IconClose,
  IconCopy,
  IconLink,
  IconLock,
  IconPlus,
  IconSearch,
  IconSend,
  IconTrash,
} from './icons';

/**
 * The one read this screen does: every bot the signed-in account owns.
 *
 * A module-level function rather than a hook, so both the mount effect and the refresh path call
 * the same request without either having to know about the other's state.
 */
async function fetchBots(): Promise<{ bots: Bot[]; threads: Record<string, BotThread> }> {
  const res = await api<{ bots: Bot[]; threads: BotThread[] }>('/api/bots');
  const threads: Record<string, BotThread> = {};
  for (const thread of res.threads) threads[thread.botId] = thread;
  return { bots: res.bots, threads };
}

/**
 * The Bots screen: create, inspect, test and revoke the bots this account owns.
 *
 * DATA IS LOADED IN THE BROWSER, ON PURPOSE
 *
 * The obvious alternative is to read the list on the server and hand it down as a prop, which
 * paints faster. It is not done here because of dates: every row shows a creation date rendered
 * with toLocaleDateString, and the server's locale is not the browser's. Rendering that on the
 * server and again on the client is a hydration mismatch — React would quietly throw the server's
 * markup away and re-render, which looks like a flicker with no explanation.
 *
 * The cost is one request after mount, and the loading state that goes with it. That state is not
 * a consolation prize: it is the same one the sidebar shows for chats ("Loading your chats…"), so
 * the screen behaves like the rest of the app rather than being the one page that pops.
 *
 * NOTHING IS KEPT ON THE CLIENT
 *
 * No localStorage, no sessionStorage, no cache. The list is server state and is re-read after
 * every change, so what is on screen is what the database holds. The one thing held in memory is
 * a newly created token, in `tokens` below, and it is deliberately not persisted: it is the only
 * copy that will ever exist, so writing it to disk on a shared machine would undo the reason it
 * is shown once. Leaving the page discards it, which is correct.
 */
export function BotsScreen({
  me,
  telegram,
}: {
  me: PublicUser;
  /**
   * Whether the server has a Telegram Bot API address configured, and the setup message to show
   * if it does not. Decided on the server because the answer comes from the server's environment
   * — the browser cannot see it, and a second guess in the client would be a second thing to get
   * wrong.
   */
  telegram: { configured: boolean; setupMessage: string | null };
}) {
  const [bots, setBots] = useState<Bot[]>([]);
  /** Started conversations, by bot id. Empty means none of them have been started. */
  const [threads, setThreads] = useState<Record<string, BotThread>>({});
  /**
   * Starts true, because the first render genuinely is a load: the list comes from the effect
   * below rather than from a prop. Turning it on at the top of `load()` instead would be a
   * synchronous setState inside an effect, which starts a second render before the first has
   * painted — the cascading-render pattern. Later calls to `load()` are refreshes after a change
   * the user made, and the list has already been updated from that change's own response, so they
   * deliberately do not put the spinner back.
   */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  /** Plaintext tokens minted in this session, by bot id. Memory only — see the note above. */
  const [tokens, setTokens] = useState<Record<string, string>>({});
  /** Which control is mid-flight, so exactly one button is disabled at a time. */
  const [busy, setBusy] = useState<string | null>(null);
  /** The bot whose delete is awaiting confirmation. */
  const [confirming, setConfirming] = useState<string | null>(null);
  /** The last Telegram test's outcome, by bot id. */
  const [tested, setTested] = useState<Record<string, { ok: boolean; text: string }>>({});
  /**
   * The create wizard: which step is open, or null when it is closed.
   *
   * 1 name, 2 username, 3 the optional Telegram side. Three steps short enough to keep in state
   * rather than in the URL — a route per step would let a half-finished wizard be bookmarked or
   * shared, and the answers would have to be re-entered from scratch on arrival anyway.
   */
  const [step, setStep] = useState<1 | 2 | 3 | null>(null);

  // The wizard's answers, collected a step at a time.
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  /** Whether the user has touched the username, which is what stops the suggestion overwriting it. */
  const [handleEdited, setHandleEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [telegramToken, setTelegramToken] = useState('');
  const [active, setActive] = useState(true);

  /**
   * The username field's value: what the user typed once they have typed anything, and otherwise a
   * guess derived from the name.
   *
   * Derived rather than written into state when the name changes. An effect doing that would have
   * to decide whether a change to the username meant "the user typed this" or "I just set it",
   * which is precisely the bookkeeping that produces a field fighting whoever is typing in it.
   * Here the suggestion is a function of the name and nothing else, so it cannot go stale.
   */
  const suggestedHandle = useMemo(() => suggestHandle(name), [name]);
  const effectiveHandle = handleEdited ? handle : suggestedHandle;
  const handleProblem = describeHandleProblem(effectiveHandle);

  /**
   * Re-read the list after a change, so what is on screen is what the database holds rather than
   * what this component believes it asked for. Called from the handlers below and never from the
   * mount effect — see the note on that effect for why the two are separate.
   */
  const refresh = useCallback(async () => {
    try {
      const data = await fetchBots();
      setBots(data.bots);
      setThreads(data.threads);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your bots.');
    }
  }, []);

  /**
   * The first load, written out inside the effect rather than done by calling `refresh`.
   *
   * Two reasons, and the second is not obvious. The first is that this one owns `loading`, which
   * starts true and must be cleared whether the request succeeds or fails — the refresh path has
   * no spinner to clear. The second is that a mount effect calling a function that sets state
   * reads to both a human and a linter as a synchronous setState during the effect, which is the
   * cascading-render pattern; here the await is visible on the line it happens on, so there is
   * nothing to misread.
   *
   * `cancelled` is what stops a response arriving after the screen is gone from writing into
   * state that no longer exists. React 19 treats that write as a no-op rather than a warning, so
   * this is tidiness rather than a fix — but it is also what makes the effect correct if its
   * dependencies ever stop being empty.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchBots();
        if (cancelled) return;
        setBots(data.bots);
        setThreads(data.threads);
        setError('');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your bots.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The notice clears itself. It is a confirmation of something that already happened, so it
  // should not need dismissing — but it must not be the only record either, which is why every
  // change also updates the list.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bots;
    return bots.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q) ||
        (b.handle ?? '').toLowerCase().includes(q) ||
        (b.telegramUsername ?? '').toLowerCase().includes(q)
    );
  }, [bots, query]);

  /** Shut the wizard and forget every answer in it. */
  function closeWizard() {
    setStep(null);
    setName('');
    setHandle('');
    setHandleEdited(false);
    setDescription('');
    setTelegramToken('');
    setActive(true);
    setError('');
  }

  function openWizard() {
    setError('');
    setNotice('');
    setStep(1);
  }

  /**
   * One submit handler for all three steps, so pressing Enter in a text field does what the button
   * beside it does — advance, or create on the last step.
   *
   * Written with early returns rather than a switch: the two advancing cases are a line each, and
   * the creating case is the one worth reading.
   */
  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (step === 1) {
      if (name.trim()) setStep(2);
      return;
    }
    if (step === 2) {
      if (!handleProblem) setStep(3);
      return;
    }
    await onCreate();
  }

  async function onCreate() {
    setError('');
    setNotice('');
    setBusy('create');
    try {
      const created = await post<CreatedBot>('/api/bots', {
        name,
        handle: effectiveHandle,
        description,
        active,
        // Omitted rather than sent empty when the field is blank, so the server's optional rule
        // sees an absent key instead of an empty string it would then have to special-case.
        telegramToken: telegramToken.trim() ? telegramToken.trim() : undefined,
      });
      setTokens((prev) => ({ ...prev, [created.bot.id]: created.token }));
      setBots((prev) => [created.bot, ...prev]);
      closeWizard();
      setNotice(`“${created.bot.name}” created. Copy its token now — it is not shown again.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create the bot.';
      setError(message);
      /**
       * A username taken between the suggestion and the press is fixed on step 2, so the wizard
       * goes back there. Leaving the message under a step with no username field on it would state
       * the problem without offering the place to solve it.
       */
      if (/username is already taken/i.test(message)) setStep(2);
    } finally {
      setBusy(null);
    }
  }

  async function onCopy(id: string) {
    const token = tokens[id];
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setNotice('Token copied to the clipboard.');
    } catch {
      // clipboard.writeText needs a secure context and can be refused. Saying so is better than
      // a silent no-op, because the token is on screen and can still be selected by hand.
      setError('Could not copy automatically. Select the token above and copy it manually.');
    }
  }

  async function onTest(id: string) {
    setError('');
    setBusy(`test:${id}`);
    try {
      const res = await post<{ bot: { id: string; username: string; firstName: string } }>(
        `/api/bots/${id}/telegram/test`
      );
      const who = res.bot.username ? `@${res.bot.username}` : res.bot.firstName || 'this bot';
      setTested((prev) => ({ ...prev, [id]: { ok: true, text: `Telegram answered: ${who} (id ${res.bot.id}).` } }));
      // The check records the identity server-side, so the row's stored details change too.
      await refresh();
    } catch (err) {
      setTested((prev) => ({
        ...prev,
        [id]: { ok: false, text: err instanceof Error ? err.message : 'The Telegram test failed.' },
      }));
    } finally {
      setBusy(null);
    }
  }

  async function onRevoke(id: string, botName: string) {
    setError('');
    setBusy(`revoke:${id}`);
    try {
      const res = await post<{ revoked: boolean }>(`/api/bots/${id}/revoke-token`);
      setNotice(
        res.revoked
          ? `Token for “${botName}” revoked. It will not authenticate again.`
          : `“${botName}” had no live token to revoke.`
      );
      // The only copy of a revoked token is now worthless, so drop it if it is still on screen.
      setTokens((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke the token.');
    } finally {
      setBusy(null);
    }
  }

  async function onDelete(id: string, botName: string) {
    setError('');
    setBusy(`delete:${id}`);
    try {
      await remove(`/api/bots/${id}`);
      setBots((prev) => prev.filter((b) => b.id !== id));
      setConfirming(null);
      setThreads((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setTokens((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setNotice(`“${botName}” deleted.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the bot.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="bots-wrap">
      <header className="bots-head">
        <Link href="/chat" className="bots-back" aria-label="Back to chats">
          <IconBack size={22} />
        </Link>
        <div>
          <h1 className="bots-title">Bots</h1>
          <p className="hint">
            Telegram bots owned by @{me.username}. Each one gets a Varnox username and an API
            token when it is created. Use the form here, or talk to the Support bot.
          </p>
        </div>
        <Link href="/bots/support" className="btn ghost">
          Support bot
        </Link>
        <button
          type="button"
          className="btn"
          onClick={() => (step === null ? openWizard() : closeWizard())}
          aria-expanded={step !== null}
        >
          <IconPlus size={17} /> {step === null ? 'New bot' : 'Close'}
        </button>
      </header>

      {/*
        Shown when TELEGRAM_BOT_API_URL is unset. The screen says what is missing and what to do
        rather than falling back to a public address: a hardcoded default would either send an
        operator's token to a server they did not choose, or fail in a way that looks like a bug.
      */}
      {!telegram.configured && telegram.setupMessage ? (
        <div className="bots-setup" role="status">
          <span className="ic">
            <IconLink size={18} />
          </span>
          <div>
            <b>Telegram is not configured</b>
            <p>{telegram.setupMessage}</p>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="bots-alert error" role="alert">
          {error}
        </p>
      ) : null}

      {step !== null ? (
        <form className="bots-card bots-form" onSubmit={onSubmit}>
          {/*
            A progress line rather than a numbered headline. Each step is one or two fields, so
            saying where you are is enough; a list of step titles would take more room than the
            thing it labels.
          */}
          <div className="bots-steps">
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className={`bots-step${step === n ? ' on' : ''}${step > n ? ' done' : ''}`}
              />
            ))}
            <b>Step {step} of 3</b>
          </div>

          {step === 1 ? (
            <div className="bots-field">
              <label htmlFor="bot-name">Bot name</label>
              <input
                id="bot-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder="Support bot"
                autoComplete="off"
                autoFocus
              />
              <small className="hint">
                What you call it. Its Varnox username is chosen on the next step.
              </small>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="bots-field">
              <label htmlFor="bot-handle">Username</label>
              <div className="bots-handle">
                <span aria-hidden>@</span>
                <input
                  id="bot-handle"
                  className="input"
                  value={effectiveHandle}
                  onChange={(e) => {
                    setHandle(e.target.value);
                    setHandleEdited(true);
                  }}
                  maxLength={32}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="bot-handle-note"
                  autoFocus
                />
              </div>
              {/* The problem replaces the note rather than sitting beside it: there is only ever
                  one thing to say about this field, and saying both wastes the reading. */}
              <small id="bot-handle-note" className={`hint${handleProblem ? ' error' : ''}`}>
                {handleProblem ??
                  `@${effectiveHandle} is how this bot is named in Varnox. It is unique here and cannot be changed later.`}
              </small>
            </div>
          ) : null}

          {step === 3 ? (
            <>
              <div className="bots-field">
                <label htmlFor="bot-token">
                  Telegram bot token <span className="bots-optional">optional</span>
                </label>
                <input
                  id="bot-token"
                  className="input"
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                  maxLength={200}
                  placeholder="123456789:AA…"
                  autoComplete="off"
                  spellCheck={false}
                />
                <small className="hint">
                  From @BotFather. Varnox cannot create a Telegram bot for you — Telegram only
                  issues bot tokens through @BotFather. Leave this blank to add it later.
                </small>
              </div>

              <div className="bots-field">
                <label htmlFor="bot-description">
                  Description <span className="bots-optional">optional</span>
                </label>
                <textarea
                  id="bot-description"
                  className="input"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="What this bot is for."
                />
              </div>

              <div className="bots-field bots-toggle-row">
                <div>
                  <label htmlFor="bot-active">Active</label>
                  <small className="hint">
                    An inactive bot's token stops authenticating. Revoking is the permanent version.
                  </small>
                </div>
                <button
                  id="bot-active"
                  type="button"
                  role="switch"
                  aria-checked={active}
                  className={`switch${active ? ' on' : ''}`}
                  onClick={() => setActive((v) => !v)}
                />
              </div>
            </>
          ) : null}

          <div className="bots-form-foot">
            <button
              type="button"
              className="btn ghost"
              onClick={() => (step === 1 ? closeWizard() : setStep(step === 3 ? 2 : 1))}
            >
              {step === 1 ? 'Cancel' : 'Back'}
            </button>
            {step < 3 ? (
              <button
                type="submit"
                className="btn"
                disabled={step === 1 ? !name.trim() : Boolean(handleProblem)}
              >
                Next
              </button>
            ) : (
              <button type="submit" className="btn" disabled={busy === 'create'}>
                {busy === 'create' ? 'Creating…' : 'Create bot'}
              </button>
            )}
          </div>
        </form>
      ) : null}

      <div className="search-box bots-search">
        <IconSearch size={17} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search bots"
          aria-label="Search bots"
        />
      </div>

      {loading ? (
        <p className="bots-status">Loading your bots…</p>
      ) : bots.length === 0 ? (
        <div className="bots-empty">
          <IconBot size={44} />
          <b>No bots yet</b>
          <p className="hint">
            Create one to get a Varnox API token, and connect it to a Telegram bot token if it
            should answer on Telegram.
          </p>
          <button type="button" className="btn" onClick={openWizard}>
            Create your first bot
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="bots-status">No bots match that search.</p>
      ) : (
        <ul className="bots-list">
          {filtered.map((bot) => {
            const token = tokens[bot.id];
            const live = bot.tokenIssuedAt !== null && bot.tokenRevokedAt === null;
            const test = tested[bot.id];
            return (
              <li key={bot.id} className="bots-card bots-row">
                <div className="bots-row-top">
                  <span className="bots-mark" aria-hidden>
                    <IconBot size={20} />
                  </span>
                  <div className="bots-row-main">
                    <b className="bots-name">{bot.name}</b>
                    <div className="bots-badges">
                      {bot.handle ? <span className="bots-badge on">@{bot.handle}</span> : null}
                      <span className={`bots-badge${bot.active ? ' on' : ''}`}>
                        {bot.active ? 'Active' : 'Inactive'}
                      </span>
                      {bot.hasTelegram ? (
                        <span className="bots-badge on">
                          {bot.telegramUsername ? `@${bot.telegramUsername}` : 'Telegram linked'}
                        </span>
                      ) : (
                        <span className="bots-badge">No Telegram token</span>
                      )}
                      <span className={`bots-badge${live ? ' on' : ' off'}`}>
                        {live ? 'Token live' : bot.tokenRevokedAt ? 'Token revoked' : 'No token'}
                      </span>
                    </div>
                    {bot.description ? <p className="bots-desc">{bot.description}</p> : null}
                    {threads[bot.id] ? (
                      <div className="bots-badges">
                        <span className="bots-badge">Started</span>
                        {threads[bot.id].pending > 0 ? (
                          <span className="bots-badge on">
                            {threads[bot.id].pending} waiting for the bot
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <p className="bots-meta">
                      Created {dateStamp(bot.createdAt)}
                      {bot.telegramCheckedAt
                        ? ` · Telegram last checked ${relativeTime(bot.telegramCheckedAt)}`
                        : ''}
                    </p>
                  </div>
                </div>

                {/*
                  The one place a plaintext token is ever drawn. It exists only while this session
                  holds it, and the copy button goes away with it.
                */}
                {token ? (
                  <div className="bots-reveal">
                    <b>Your Varnox API token</b>
                    <code className="bots-token">{token}</code>
                    <p className="hint">
                      This is the only time it is shown. Varnox stored a hash, not the token, so it
                      cannot be recovered — if it is lost, delete the bot and create it again.
                    </p>
                    <div className="bots-actions">
                      <button type="button" className="btn" onClick={() => onCopy(bot.id)}>
                        <IconCopy size={16} /> Copy token
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() =>
                          setTokens((prev) => {
                            const next = { ...prev };
                            delete next[bot.id];
                            return next;
                          })
                        }
                      >
                        <IconCheck size={16} /> Done
                      </button>
                    </div>
                  </div>
                ) : null}

                {test ? (
                  <p className={`bots-test hint${test.ok ? '' : ' error'}`}>
                    {test.ok ? <IconCheck size={15} /> : <IconClose size={15} />} {test.text}
                  </p>
                ) : null}

                {confirming === bot.id ? (
                  <div className="danger-confirm">
                    <p className="hint">
                      Delete “{bot.name}” and its tokens? This cannot be undone, and a revoked or
                      deleted token cannot be recovered.
                    </p>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn danger"
                        disabled={busy === `delete:${bot.id}`}
                        onClick={() => onDelete(bot.id, bot.name)}
                      >
                        {busy === `delete:${bot.id}` ? 'Deleting…' : 'Delete bot'}
                      </button>
                      <button type="button" className="btn ghost" onClick={() => setConfirming(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bots-actions">
                    {/*
                      One tap from the search results to the conversation, which is the flow people
                      expect from a bot: find it by username, press Start. The label follows whether
                      the thread exists, so it says what the button will actually do.
                    */}
                    <Link href={`/bots/${bot.id}`} className="btn">
                      <IconBot size={16} /> {threads[bot.id] ? 'Open chat' : 'Start'}
                    </Link>
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busy !== null}
                      onClick={() => onTest(bot.id)}
                    >
                      <IconSend size={16} />
                      {busy === `test:${bot.id}` ? 'Testing…' : 'Test Telegram'}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busy !== null || !live}
                      title={live ? 'Withdraw this token' : 'There is no live token to revoke'}
                      onClick={() => onRevoke(bot.id, bot.name)}
                    >
                      <IconLock size={16} />
                      {busy === `revoke:${bot.id}` ? 'Revoking…' : 'Revoke token'}
                    </button>
                    <button
                      type="button"
                      className="btn danger"
                      disabled={busy !== null}
                      onClick={() => setConfirming(bot.id)}
                    >
                      <IconTrash size={16} /> Delete
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {notice ? (
        <div className="toast" role="status">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
