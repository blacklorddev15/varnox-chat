'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, post, uploadMedia } from '@/lib/client';
import type {
  Call,
  ChatRow,
  Message,
  PublicUser,
  StarredItem,
  UserSettings,
} from '@/lib/types';
import { CallScreen, IncomingCall } from './calls';
import { Sidebar } from './sidebar';
import { ChatPane } from './chat-pane';
import { SettingsScreen } from './settings-screen';
import { StarredPanel, SearchPanel, ForwardPanel } from './overlays';
import {
  NewChatPanel,
  NewGroupPanel,
  ProfilePanel,
  ChatInfoPanel,
  LinkedDevicesPanel,
  WhatsAppLinkPanel,
} from './panels';

export type ReplyDraft = { id: string; text: string; senderName: string } | null;

type MessagesResponse = {
  messages: Message[];
  cursor: string | null;
  hasMore: boolean;
  reads: Record<string, number>;
  reactions: Record<string, Record<string, string>>;
  views: Record<string, string[]>;
  typing: string[];
  disappearSec: number;
  serverAt: number;
};

const DEFAULT_SETTINGS: UserSettings = {
  userId: '',
  wallpaper: 'doodle',
  notifications: true,
  privacy: {
    lastSeen: 'everyone',
    profilePhoto: 'everyone',
    readReceipts: true,
    statusPrivacy: 'everyone',
  },
  chatPrefs: {},
  blocked: [],
  at: 0,
};

function beep() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.32);
    window.setTimeout(() => ctx.close().catch(() => undefined), 600);
  } catch {
    /* audio is a nicety, never a blocker */
  }
}

export function Messenger({ me: initialMe }: { me: PublicUser }) {
  const router = useRouter();
  const [me, setMe] = useState<PublicUser>(initialMe);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reads, setReads] = useState<Record<string, number>>({});
  const [reactions, setReactions] = useState<Record<string, Record<string, string>>>({});
  const [views, setViews] = useState<Record<string, string[]>>({});
  const [typing, setTyping] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [disappearSec, setDisappearSec] = useState(0);
  const [listReady, setListReady] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState<ReplyDraft>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [panel, setPanel] = useState<
    | null
    | 'new-chat'
    | 'new-group'
    | 'profile'
    | 'chat-info'
    | 'settings'
    | 'linked-devices'
    | 'whatsapp-link'
    | 'starred'
    | 'search'
    | 'forward'
  >(null);
  const [starred, setStarred] = useState<StarredItem[]>([]);
  const [toast, setToast] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [filter, setFilter] = useState<'all' | 'unread' | 'groups'>('all');
  const [forwardIds, setForwardIds] = useState<string[]>([]);
  /** Which bottom tab the phone layout is on. Wide screens ignore it and show chats. */
  const [tab, setTab] = useState<'chats' | 'updates' | 'channels' | 'calls'>('chats');
  /** The live call, if there is one: it drives the incoming surface and the in-call screen. */
  const [call, setCall] = useState<Call | null>(null);
  const [callStarting, setCallStarting] = useState(false);

  const lastAtRef = useRef(0);
  const selectedRef = useRef<string | null>(null);
  const messagesBox = useRef<HTMLDivElement | null>(null);
  const seenLastIds = useRef<Map<string, string>>(new Map());
  const firstListLoad = useRef(true);
  const typingSentAt = useRef(0);

  const selected = useMemo(() => chats.find((c) => c.id === selectedId) ?? null, [chats, selectedId]);

  /* ---------------------------------------------------------------- theme */

  useEffect(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    setTheme(attr === 'light' ? 'light' : 'dark');
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem('varnox-theme', next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  }, []);

  /* -------------------------------------------------------------- settings */

  const loadSettings = useCallback(async () => {
    try {
      const res = await api<{ settings: UserSettings }>('/api/settings');
      setSettings(res.settings);
    } catch {
      /* keep defaults */
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const saveSettings = useCallback(
    async (patchBody: Record<string, unknown>) => {
      try {
        const res = await api<{ settings: UserSettings }>('/api/settings', {
          method: 'PATCH',
          body: JSON.stringify(patchBody),
        });
        setSettings(res.settings);
        return res.settings;
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not save settings');
        return null;
      }
    },
    [flash]
  );

  /* ----------------------------------------------------------------- data */

  const loadChats = useCallback(async () => {
    try {
      const res = await api<{ chats: ChatRow[] }>('/api/chats');
      setChats(res.chats);
      setListReady(true);

      const map = seenLastIds.current;
      const fresh: ChatRow[] = [];
      for (const chat of res.chats) {
        const last = chat.last;
        if (!last) continue;
        const known = map.get(chat.id);
        if (known !== last.id) {
          map.set(chat.id, last.id);
          if (!firstListLoad.current && last.senderId !== me.id) fresh.push(chat);
        }
      }
      firstListLoad.current = false;

      if (fresh.length && document.visibilityState !== 'visible' && settings.notifications) {
        beep();
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          for (const chat of fresh.slice(0, 3)) {
            try {
              const n = new Notification(chat.title, {
                body: chat.last?.text || 'New message',
                icon: '/icon-192.png',
                tag: chat.id,
              });
              n.onclick = () => {
                window.focus();
                openChatRef.current?.(chat.id);
              };
            } catch {
              /* ignore */
            }
          }
        }
      }
      return res.chats;
    } catch (err) {
      if (err instanceof Error && /not signed in/i.test(err.message)) router.replace('/login');
      return null;
    }
  }, [me.id, router, settings.notifications]);

  /* presence heartbeat, also reports which peers are online */
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      const ids = Array.from(new Set(chats.flatMap((c) => c.members))).filter((id) => id !== me.id);
      try {
        const res = await post<{ presence: Record<string, number> }>('/api/presence', { ids });
        if (cancelled) return;
        setChats((prev) =>
          prev.map((chat) => ({
            ...chat,
            peer: chat.peer
              ? { ...chat.peer, lastSeen: Math.max(chat.peer.lastSeen, res.presence[chat.peer.id] ?? 0) }
              : chat.peer,
            memberProfiles: chat.memberProfiles.map((p) => ({
              ...p,
              lastSeen: Math.max(p.lastSeen, res.presence[p.id] ?? 0),
            })),
          }))
        );
      } catch {
        /* ignore */
      }
    };
    ping();
    const id = window.setInterval(ping, 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [chats.length, me.id]);

  const openChat = useCallback(
    async (chatId: string) => {
      selectedRef.current = chatId;
      setSelectedId(chatId);
      setMessages([]);
      setCursor(null);
      setHasMore(false);
      setReply(null);
      setSelection([]);
      setTyping([]);
      setOpeningChat(true);
      try {
        const res = await api<MessagesResponse>(`/api/chats/${chatId}/messages?limit=45`);
        setMessages(res.messages);
        setCursor(res.cursor);
        setHasMore(res.hasMore);
        setReads(res.reads);
        setReactions(res.reactions);
        setViews(res.views);
        setDisappearSec(res.disappearSec);
        lastAtRef.current = res.messages.length ? res.messages[res.messages.length - 1].at : 0;
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not open that chat');
      } finally {
        setOpeningChat(false);
      }
    },
    [flash]
  );
  const openChatRef = useRef<((id: string) => void) | null>(null);
  openChatRef.current = openChat;

  const pollOpenChat = useCallback(async () => {
    const chatId = selectedRef.current;
    if (!chatId) return;
    try {
      const since = lastAtRef.current || 1;
      const res = await api<MessagesResponse>(`/api/chats/${chatId}/messages?since=${since}`);
      setReads(res.reads);
      setReactions(res.reactions);
      setViews(res.views);
      setTyping(res.typing);
      setDisappearSec(res.disappearSec);
      if (res.messages.length) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const fresh = res.messages.filter((m) => !seen.has(m.id));
          if (!fresh.length) return prev;
          const next = [...prev, ...fresh].sort((a, b) => a.at - b.at);
          lastAtRef.current = next[next.length - 1].at;
          return next;
        });
      }
    } catch {
      /* keep polling */
    }
  }, []);

  const loadOlder = useCallback(async () => {
    const chatId = selectedRef.current;
    if (!chatId || !cursor) return;
    try {
      const res = await api<MessagesResponse>(
        `/api/chats/${chatId}/messages?limit=45&cursor=${encodeURIComponent(cursor)}`
      );
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const older = res.messages.filter((m) => !seen.has(m.id));
        return [...older, ...prev].sort((a, b) => a.at - b.at);
      });
      setCursor(res.cursor);
      setHasMore(res.hasMore);
    } catch {
      flash('Could not load older messages');
    }
  }, [cursor, flash]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  /* ---------------------------------------------------------------- calls */

  /* One poll answers "is there a call for me", and the cadence changes with the answer: about a
     second while something is ringing or up, so accepting and the ICE exchange feel immediate,
     and the idle 8s the chat list already runs at the rest of the time. Nothing else is fetched
     for the call, so an idle poll costs one cheap query. */
  const callRef = useRef<Call | null>(null);
  const callPollBusy = useRef(false);

  const pollActiveCall = useCallback(async () => {
    if (callPollBusy.current) return;
    callPollBusy.current = true;
    try {
      const res = await api<{ call: Call | null }>('/api/calls/active');
      const before = callRef.current;
      callRef.current = res.call;
      setCall(res.call);
      // An outgoing call that is simply gone was not answered — declined, or the 45 second
      // window ran out. Either way this screen has to stop ringing, and saying so once beats it
      // disappearing without explanation.
      if (before && !res.call && before.status === 'ringing' && before.callerId === me.id) {
        flash('Call ended');
      }
    } catch {
      /* a poll that fails just tries again on the next tick */
    } finally {
      callPollBusy.current = false;
    }
  }, [flash, me.id]);

  const inCall = call !== null;

  useEffect(() => {
    pollActiveCall();
    const id = window.setInterval(
      () => {
        if (document.visibilityState === 'visible') pollActiveCall();
      },
      inCall ? 1000 : 8000
    );
    const onVisible = () => {
      if (document.visibilityState === 'visible') pollActiveCall();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [inCall, pollActiveCall]);

  const startCall = useCallback(
    async (userId: string, kind: 'audio' | 'video') => {
      if (callStarting) return;
      setCallStarting(true);
      try {
        const res = await post<{ call: Call }>('/api/calls', { calleeId: userId, kind });
        callRef.current = res.call;
        setCall(res.call);
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not start the call');
      } finally {
        setCallStarting(false);
      }
    },
    [callStarting, flash]
  );

  const acceptIncoming = useCallback(async () => {
    const current = callRef.current;
    if (!current) return;
    try {
      const res = await post<{ call: Call }>(`/api/calls/${current.id}/accept`);
      callRef.current = res.call;
      setCall(res.call);
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Could not answer the call');
      callRef.current = null;
      setCall(null);
    }
  }, [flash]);

  const declineIncoming = useCallback(async () => {
    const current = callRef.current;
    // Drop it first: the ringtone belongs to the incoming surface being mounted, so it stops on
    // this line rather than whenever the request comes back.
    callRef.current = null;
    setCall(null);
    if (!current) return;
    try {
      await post(`/api/calls/${current.id}/decline`);
    } catch {
      /* the call is over either way */
    }
  }, []);

  /** The call screen finished tearing itself down — it has already told the server. */
  const callEnded = useCallback(() => {
    callRef.current = null;
    setCall(null);
  }, []);

  /* Who the call picker offers first: the people this account already talks to one to one. */
  const callRecents = useMemo(() => {
    const seen = new Set<string>();
    const out: PublicUser[] = [];
    for (const chat of chats) {
      if (chat.type !== 'direct' || !chat.peer) continue;
      if (seen.has(chat.peer.id)) continue;
      seen.add(chat.peer.id);
      out.push(chat.peer);
      if (out.length >= 8) break;
    }
    return out;
  }, [chats]);

  /* One poll at a time. On a cold serverless database a request can take longer than the
     interval, and without this the ticks stack up into a queue of overlapping queries that
     makes the app feel slower the longer it stays open. */
  const listBusy = useRef(false);
  const chatBusy = useRef(false);

  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== 'visible' || listBusy.current) return;
      listBusy.current = true;
      try {
        await loadChats();
      } finally {
        listBusy.current = false;
      }
    };
    // 8s rather than 3.5s: a chat list is glancing information, and every poll costs a round
    // trip to a serverless function and a fresh connection through the database pooler.
    const id = window.setInterval(tick, 8000);
    return () => window.clearInterval(id);
  }, [loadChats]);

  useEffect(() => {
    if (!selectedId) return;
    const id = window.setInterval(async () => {
      if (document.visibilityState !== 'visible' || chatBusy.current) return;
      chatBusy.current = true;
      try {
        await pollOpenChat();
      } finally {
        chatBusy.current = false;
      }
    }, 4000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        pollOpenChat();
        loadChats();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [selectedId, pollOpenChat, loadChats]);

  useEffect(() => {
    const chatId = selectedRef.current;
    if (!chatId || !messages.length) return;
    const lastAt = messages[messages.length - 1].at;
    if (document.visibilityState !== 'visible') return;
    post(`/api/chats/${chatId}/read`, { at: lastAt })
      .then(() => loadChats())
      .catch(() => undefined);
  }, [messages, loadChats]);

  useEffect(() => {
    const box = messagesBox.current;
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 320;
    if (nearBottom) {
      requestAnimationFrame(() => {
        box.scrollTop = box.scrollHeight;
      });
    }
  }, [messages]);

  /* ------------------------------------------------------------- actions */

  const notifyTyping = useCallback(() => {
    const chatId = selectedRef.current;
    if (!chatId) return;
    const now = Date.now();
    if (now - typingSentAt.current < 3000) return;
    typingSentAt.current = now;
    post(`/api/chats/${chatId}/typing`).catch(() => undefined);
  }, []);

  const send = useCallback(
    async (payload: {
      text: string;
      image?: File | null;
      audio?: { blob: Blob; sec: number } | null;
      file?: File | null;
      location?: { lat: number; lng: number };
      contact?: { name: string; phone: string };
      once?: boolean;
    }) => {
      const chatId = selectedRef.current;
      if (!chatId || sending) return;
      setSending(true);
      try {
        let body: Record<string, unknown> = { type: 'text', text: payload.text, replyTo: reply };
        // Location and contact carry a payload instead of a mediaUrl.
        if (payload.location) {
          body = {
            type: 'location',
            text: '',
            payload: { lat: payload.location.lat, lng: payload.location.lng },
            replyTo: reply,
          };
        } else if (payload.contact) {
          body = {
            type: 'contact',
            text: '',
            payload: { name: payload.contact.name, phone: payload.contact.phone },
            replyTo: reply,
          };
        } else if (payload.image) {
          const up = await uploadMedia(payload.image, 'image', Boolean(payload.once));
          body = {
            type: 'image',
            text: payload.text,
            mediaUrl: up.url,
            mediaW: up.width,
            mediaH: up.height,
            replyTo: reply,
            ...(payload.once ? { once: true } : {}),
          };
        } else if (payload.audio) {
          const up = await uploadMedia(
            new File([payload.audio.blob], 'voice.webm', { type: payload.audio.blob.type || 'audio/webm' }),
            'audio',
            Boolean(payload.once)
          );
          body = {
            type: 'audio',
            text: '',
            mediaUrl: up.url,
            audioSec: payload.audio.sec,
            mime: up.mime,
            replyTo: reply,
            ...(payload.once ? { once: true } : {}),
          };
        } else if (payload.file) {
          const up = await uploadMedia(payload.file, 'auto');
          body = {
            type: 'file',
            text: payload.text,
            mediaUrl: up.url,
            fileName: payload.file.name,
            fileSize: up.size,
            mime: up.mime,
            replyTo: reply,
          };
        }

        const res = await post<{ message: Message }>(`/api/chats/${chatId}/messages`, body);
        setMessages((prev) => {
          if (prev.some((m) => m.id === res.message.id)) return prev;
          lastAtRef.current = res.message.at;
          return [...prev, res.message];
        });
        setReply(null);
        window.setTimeout(() => loadChats(), 250);
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Message was not sent');
      } finally {
        setSending(false);
      }
    },
    [flash, loadChats, reply, sending]
  );

  const react = useCallback(
    async (msg: Message, emoji: string) => {
      try {
        const res = await post<{ reactions: Record<string, Record<string, string>> }>(
          `/api/messages/${msg.id}/react`,
          { convId: msg.convId, emoji }
        );
        setReactions(res.reactions);
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not react');
      }
    },
    [flash]
  );

  const editMessage = useCallback(
    async (msg: Message, text: string) => {
      try {
        await api(`/api/messages/${msg.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ convId: msg.convId, text }),
        });
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, text } : m)));
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not edit that message');
      }
    },
    [flash]
  );

  const deleteMessage = useCallback(
    async (msg: Message) => {
      try {
        await api(`/api/messages/${msg.id}?convId=${encodeURIComponent(msg.convId)}`, {
          method: 'DELETE',
        });
        setMessages((prev) => prev.filter((m) => m.id !== msg.id));
        window.setTimeout(() => loadChats(), 250);
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not delete that message');
      }
    },
    [flash, loadChats]
  );

  const starMessage = useCallback(
    async (msg: Message, on: boolean) => {
      try {
        if (on) await post(`/api/messages/${msg.id}/star`, { convId: msg.convId });
        else await api(`/api/messages/${msg.id}/star?convId=${encodeURIComponent(msg.convId)}`, { method: 'DELETE' });
        flash(on ? 'Message starred' : 'Star removed');
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not update the star');
      }
    },
    [flash]
  );

  const openStarred = useCallback(async () => {
    setPanel('starred');
    try {
      const res = await api<{ starred: StarredItem[] }>('/api/starred');
      setStarred(res.starred);
    } catch {
      setStarred([]);
    }
  }, []);

  const bulkAction = useCallback(
    async (action: 'delete' | 'star' | 'unstar') => {
      const chatId = selectedRef.current;
      if (!chatId || !selection.length) return;
      try {
        const res = await post<Record<string, number>>('/api/messages/bulk', {
          convId: chatId,
          ids: selection,
          action,
        });
        if (action === 'delete') {
          setMessages((prev) => prev.filter((m) => !selection.includes(m.id)));
          const skipped = res.skipped ?? 0;
          flash(skipped ? `Deleted ${res.deleted}; ${skipped} were not yours` : `Deleted ${res.deleted}`);
        } else {
          flash(action === 'star' ? `Starred ${res.starred}` : `Unstarred ${res.unstarred}`);
        }
        setSelection([]);
        window.setTimeout(() => loadChats(), 250);
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Action failed');
      }
    },
    [flash, loadChats, selection]
  );

  const startForward = useCallback(
    (ids: string[]) => {
      setForwardIds(ids);
      setPanel('forward');
    },
    []
  );

  const doForward = useCallback(
    async (targets: string[]) => {
      const chatId = selectedRef.current;
      if (!chatId || !forwardIds.length) return;
      try {
        const res = await post<{ forwarded: number }>('/api/messages/forward', {
          convId: chatId,
          ids: forwardIds,
          targets,
        });
        setPanel(null);
        setSelection([]);
        flash(`Forwarded ${res.forwarded}`);
        window.setTimeout(() => loadChats(), 300);
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Forward failed');
      }
    },
    [flash, forwardIds, loadChats]
  );

  const startChatWith = useCallback(
    async (userId: string) => {
      try {
        const res = await post<{ chat: ChatRow }>('/api/chats', { type: 'direct', userId });
        setPanel(null);
        await loadChats();
        await openChat(res.chat.id);
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not start that chat');
      }
    },
    [flash, loadChats, openChat]
  );

  const createGroup = useCallback(
    async (name: string, memberIds: string[]) => {
      try {
        const res = await post<{ chat: ChatRow }>('/api/chats', {
          type: 'group',
          name,
          members: memberIds,
        });
        setPanel(null);
        await loadChats();
        await openChat(res.chat.id);
        flash('Group created');
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not create the group');
      }
    },
    [flash, loadChats, openChat]
  );

  const leaveChat = useCallback(
    async (chatId: string) => {
      try {
        await api(`/api/chats/${chatId}`, { method: 'DELETE' });
        setPanel(null);
        if (selectedRef.current === chatId) {
          selectedRef.current = null;
          setSelectedId(null);
          setMessages([]);
        }
        await loadChats();
        flash('You left the conversation');
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not leave');
      }
    },
    [flash, loadChats]
  );

  const updateChat = useCallback(
    async (chatId: string, body: Record<string, unknown>) => {
      try {
        await api(`/api/chats/${chatId}`, { method: 'PATCH', body: JSON.stringify(body) });
        await loadChats();
        if (body.disappearSec !== undefined) setDisappearSec(Number(body.disappearSec));
        flash('Chat updated');
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not update the chat');
      }
    },
    [flash, loadChats]
  );

  const setPref = useCallback(
    async (chatId: string, pref: Record<string, boolean>) => {
      const current = settings.chatPrefs[chatId] ?? {};
      const next = { ...settings.chatPrefs, [chatId]: { ...current, ...pref } };
      setSettings((s) => ({ ...s, chatPrefs: next }));
      await saveSettings({ chatPrefs: next });
    },
    [saveSettings, settings.chatPrefs]
  );

  const saveProfile = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        const res = await api<{ user: PublicUser }>('/api/me', {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        setMe(res.user);
        setPanel(null);
        flash('Profile saved');
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not save your profile');
      }
    },
    [flash]
  );

  const joinByCode = useCallback(
    async (code: string) => {
      try {
        const res = await post<{ chat: ChatRow }>('/api/join', { code });
        await loadChats();
        await openChat(res.chat.id);
        flash('Joined the group');
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not join');
      }
    },
    [flash, loadChats, openChat]
  );

  const signOut = useCallback(async () => {
    await post('/api/auth/logout').catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }, [router]);

  const visible = useMemo(() => {
    const active = chats.filter((c) => !c.archived);
    const filtered =
      filter === 'unread'
        ? active.filter((c) => c.unread > 0)
        : filter === 'groups'
          ? active.filter((c) => c.type === 'group')
          : active;
    return [...filtered].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  }, [chats, filter]);

  const archived = useMemo(() => chats.filter((c) => c.archived), [chats]);

  return (
    <div className={`app${selectedId ? ' show-chat' : ''}`}>
      <Sidebar
        me={me}
        settings={settings}
        chats={visible}
        archived={archived}
        ready={listReady}
        selectedId={selectedId}
        filter={filter}
        tab={tab}
        recents={callRecents}
        callStarting={callStarting}
        onTab={setTab}
        onToast={flash}
        onCall={startCall}
        onFilter={setFilter}
        onSelectChat={openChat}
        onNewChat={() => setPanel('new-chat')}
        onNewGroup={() => setPanel('new-group')}
        onProfile={() => setPanel('profile')}
        onSettings={() => setPanel('settings')}
        onStarred={openStarred}
        onSearch={() => setPanel('search')}
        onJoinByCode={joinByCode}
        onToggleTheme={toggleTheme}
        onSignOut={signOut}
        onToggleArchive={(chatId, on) => setPref(chatId, { archived: on })}
      />

      <ChatPane
        me={me}
        chat={selected}
        messages={messages}
        reads={reads}
        reactions={reactions}
        views={views}
        typing={typing}
        disappearSec={disappearSec}
        hasMore={hasMore}
        loading={openingChat}
        sending={sending}
        reply={reply}
        selection={selection}
        theme={theme}
        wallpaper={settings.wallpaper}
        boxRef={messagesBox}
        onBack={() => {
          selectedRef.current = null;
          setSelectedId(null);
          setMessages([]);
        }}
        onToggleTheme={toggleTheme}
        onOpenInfo={() => setPanel('chat-info')}
        onStartChat={startChatWith}
        onSend={send}
        onReact={react}
        onReply={setReply}
        onEdit={editMessage}
        onDelete={deleteMessage}
        onStar={starMessage}
        onForward={startForward}
        onSelection={setSelection}
        onBulk={bulkAction}
        onTyping={notifyTyping}
        onLoadOlder={loadOlder}
        blocked={Boolean(selected?.peer && settings.blocked.includes(selected.peer.id))}
      />

      {panel === 'new-chat' ? (
        <NewChatPanel me={me} onClose={() => setPanel(null)} onPick={startChatWith} />
      ) : null}

      {panel === 'new-group' ? (
        <NewGroupPanel me={me} onClose={() => setPanel(null)} onCreate={createGroup} />
      ) : null}

      {panel === 'profile' ? (
        <ProfilePanel me={me} onClose={() => setPanel(null)} onSave={saveProfile} />
      ) : null}

      {panel === 'chat-info' && selected ? (
        <ChatInfoPanel
          me={me}
          chat={selected}
          onClose={() => setPanel(null)}
          onUpdate={updateChat}
          onLeave={leaveChat}
          onBlock={async (blocked) => {
            if (!selected.peer) return;
            const list = blocked
              ? Array.from(new Set([...settings.blocked, selected.peer.id]))
              : settings.blocked.filter((id) => id !== selected.peer?.id);
            await saveSettings({ blocked: list });
            flash(blocked ? 'Contact blocked' : 'Contact unblocked');
          }}
          blocked={Boolean(selected.peer && settings.blocked.includes(selected.peer.id))}
        />
      ) : null}

      {panel === 'settings' ? (
        <SettingsScreen
          me={me}
          settings={settings}
          onClose={() => setPanel(null)}
          onSave={saveSettings}
          onEditProfile={() => setPanel('profile')}
          onLinkedDevices={() => setPanel('linked-devices')}
          onLinkWhatsApp={() => setPanel('whatsapp-link')}
          onSignOut={signOut}
          onOpenStarred={openStarred}
          onToast={flash}
        />
      ) : null}

      {panel === 'linked-devices' ? (
        <LinkedDevicesPanel onClose={() => setPanel(null)} />
      ) : null}

      {panel === 'whatsapp-link' ? (
        <WhatsAppLinkPanel onClose={() => setPanel(null)} />
      ) : null}

      {panel === 'starred' ? (
        <StarredPanel
          items={starred}
          onClose={() => setPanel(null)}
          onOpenChat={(chatId) => {
            setPanel(null);
            openChat(chatId);
          }}
        />
      ) : null}

      {panel === 'search' ? (
        <SearchPanel
          onClose={() => setPanel(null)}
          onOpenChat={(chatId) => {
            setPanel(null);
            openChat(chatId);
          }}
        />
      ) : null}

      {panel === 'forward' ? (
        <ForwardPanel chats={chats} onClose={() => setPanel(null)} onForward={doForward} />
      ) : null}

      {/* A call is never a panel: it takes the whole screen, above every sheet, whichever tab
          happens to be open underneath. The incoming surface is only for the party being
          called — the caller is already on the call screen, ringing. */}
      {call && call.status === 'ringing' && call.calleeId === me.id ? (
        <IncomingCall call={call} onAccept={acceptIncoming} onDecline={declineIncoming} />
      ) : call ? (
        <CallScreen me={me} call={call} onEnded={callEnded} onToast={flash} />
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
