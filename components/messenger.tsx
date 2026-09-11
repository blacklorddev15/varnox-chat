'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, post, uploadImage } from '@/lib/client';
import type { ChatRow, Message, PublicUser } from '@/lib/types';
import { Sidebar } from './sidebar';
import { ChatPane } from './chat-pane';
import { NewChatPanel, NewGroupPanel, ProfilePanel, ChatInfoPanel } from './panels';

type MessagesResponse = {
  messages: Message[];
  cursor: string | null;
  hasMore: boolean;
  reads: Record<string, number>;
  serverAt: number;
};

export type ReplyDraft = { id: string; text: string; senderName: string } | null;

export function Messenger({ me: initialMe }: { me: PublicUser }) {
  const router = useRouter();
  const [me, setMe] = useState<PublicUser>(initialMe);
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reads, setReads] = useState<Record<string, number>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [listReady, setListReady] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState<ReplyDraft>(null);
  const [panel, setPanel] = useState<null | 'new-chat' | 'new-group' | 'profile' | 'info'>(null);
  const [toast, setToast] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const lastAtRef = useRef(0);
  const selectedRef = useRef<string | null>(null);
  const messagesBox = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => chats.find((c) => c.id === selectedId) ?? null,
    [chats, selectedId]
  );

  /* ------------------------------------------------------------- theme */

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

  /* ------------------------------------------------------------- data */

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  }, []);

  const loadChats = useCallback(async () => {
    try {
      const res = await api<{ chats: ChatRow[] }>('/api/chats');
      setChats(res.chats);
      setListReady(true);
      return res.chats;
    } catch (err) {
      if (err instanceof Error && /not signed in/i.test(err.message)) {
        router.replace('/login');
      }
      return null;
    }
  }, [router]);

  const openChat = useCallback(async (chatId: string) => {
    selectedRef.current = chatId;
    setSelectedId(chatId);
    setMessages([]);
    setCursor(null);
    setHasMore(false);
    setReply(null);
    setOpeningChat(true);
    try {
      const res = await api<MessagesResponse>(`/api/chats/${chatId}/messages?limit=45`);
      setMessages(res.messages);
      setCursor(res.cursor);
      setHasMore(res.hasMore);
      setReads(res.reads);
      lastAtRef.current = res.messages.length ? res.messages[res.messages.length - 1].at : 0;
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Could not open that chat');
    } finally {
      setOpeningChat(false);
    }
  }, [flash]);

  const pollOpenChat = useCallback(async () => {
    const chatId = selectedRef.current;
    if (!chatId) return;
    try {
      const since = lastAtRef.current || 1;
      const res = await api<MessagesResponse>(
        `/api/chats/${chatId}/messages?since=${since}`
      );
      setReads(res.reads);
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

  /* initial list load + background refresh */
  useEffect(() => {
    loadChats();
  }, [loadChats]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') loadChats();
    };
    const id = window.setInterval(tick, 3500);
    return () => window.clearInterval(id);
  }, [loadChats]);

  /* poll the open conversation */
  useEffect(() => {
    if (!selectedId) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') pollOpenChat();
    }, 2000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') pollOpenChat();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [selectedId, pollOpenChat]);

  /* mark the open chat as read */
  useEffect(() => {
    const chatId = selectedRef.current;
    if (!chatId || !messages.length) return;
    const lastAt = messages[messages.length - 1].at;
    if (document.visibilityState !== 'visible') return;
    post(`/api/chats/${chatId}/read`, { at: lastAt })
      .then(() => loadChats())
      .catch(() => undefined);
  }, [messages, loadChats]);

  /* keep the view pinned to the newest message */
  const prevCount = useRef(0);
  useEffect(() => {
    const box = messagesBox.current;
    if (!box) return;
    const grew = messages.length > prevCount.current;
    prevCount.current = messages.length;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 320;
    if (grew && nearBottom) {
      requestAnimationFrame(() => {
        box.scrollTop = box.scrollHeight;
      });
    }
  }, [messages]);

  /* ------------------------------------------------------------- actions */

  const send = useCallback(
    async (text: string, image?: File | null) => {
      const chatId = selectedRef.current;
      if (!chatId || sending) return;
      setSending(true);
      try {
        let body: Record<string, unknown> = { type: 'text', text, replyTo: reply };
        if (image) {
          const uploaded = await uploadImage(image);
          body = {
            type: 'image',
            text,
            mediaUrl: uploaded.url,
            mediaW: uploaded.width,
            mediaH: uploaded.height,
            replyTo: reply,
          };
        }
        const res = await post<{ message: Message }>(`/api/chats/${chatId}/messages`, body);
        setMessages((prev) => {
          if (prev.some((m) => m.id === res.message.id)) return prev;
          const next = [...prev, res.message];
          lastAtRef.current = res.message.at;
          return next;
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

  const editMessage = useCallback(
    async (msg: Message, text: string) => {
      try {
        await api(`/api/messages/${msg.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ convId: msg.convId, text }),
        });
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? { ...m, text } : m))
        );
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
        flash('Group updated');
      } catch (err) {
        flash(err instanceof Error ? err.message : 'Could not update the group');
      }
    },
    [flash, loadChats]
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

  const signOut = useCallback(async () => {
    await post('/api/auth/logout').catch(() => undefined);
    router.replace('/login');
    router.refresh();
  }, [router]);

  /* ------------------------------------------------------------- render */

  return (
    <div className={`app${selectedId ? ' show-chat' : ''}`}>
      <Sidebar
        me={me}
        chats={chats}
        ready={listReady}
        selectedId={selectedId}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSelectChat={openChat}
        onNewChat={() => setPanel('new-chat')}
        onNewGroup={() => setPanel('new-group')}
        onProfile={() => setPanel('profile')}
        onSignOut={signOut}
      />

      <ChatPane
        me={me}
        chat={selected}
        messages={messages}
        reads={reads}
        hasMore={hasMore}
        loading={openingChat}
        sending={sending}
        reply={reply}
        theme={theme}
        boxRef={messagesBox}
        onBack={() => {
          selectedRef.current = null;
          setSelectedId(null);
          setMessages([]);
        }}
        onToggleTheme={toggleTheme}
        onOpenInfo={() => setPanel('info')}
        onSend={send}
        onReply={setReply}
        onEdit={editMessage}
        onDelete={deleteMessage}
        onLoadOlder={loadOlder}
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

      {panel === 'info' && selected ? (
        <ChatInfoPanel
          me={me}
          chat={selected}
          onClose={() => setPanel(null)}
          onUpdate={updateChat}
          onLeave={leaveChat}
        />
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
