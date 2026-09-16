'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, post } from '@/lib/client';
import type { Call, CallSignal, PublicUser } from '@/lib/types';
import { presence, relativeTime } from '@/lib/format';
import { Avatar } from './avatar';
import { Sheet, useUserSearch } from './panels';
import {
  activePeers,
  describeCall,
  hangUpEndpoint,
  joinedParticipants,
  peerFailureEndsCall,
  reconcile,
  shouldOffer,
} from '@/lib/mesh';
import {
  IconBack,
  IconCallEnd,
  IconClose,
  IconMic,
  IconMicOff,
  IconNewCall,
  IconPhone,
  IconPhoneIncoming,
  IconPhoneMissed,
  IconPhoneOutgoing,
  IconPlus,
  IconSearch,
  IconSpeaker,
  IconSpeakerOff,
  IconVideoCall,
  IconVideoOff,
} from './icons';

type CallKind = 'audio' | 'video';

/** Elapsed time, m:ss — the same shape the voice note's own clock uses. */
function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A ringing tone, made rather than fetched: two oscillators a few hundred milliseconds long,
 * repeated until the caller gives up or the call is answered.
 *
 * Guarded at every step for the same reason beep() is — an AudioContext that does not exist, or
 * one the browser refuses to start because the page has had no gesture yet, must not throw.
 * Silent is an acceptable outcome. Playing is the bonus. No audio file is involved.
 */
function useRingtone(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let ctx: AudioContext | null = null;
    let timer = 0;
    let stopped = false;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      const burst = () => {
        if (stopped || !ctx) return;
        try {
          const at = ctx.currentTime;
          for (const frequency of [440, 480]) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = frequency;
            gain.gain.setValueAtTime(0.0001, at);
            gain.gain.exponentialRampToValueAtTime(0.07, at + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
            osc.start(at);
            osc.stop(at + 0.36);
          }
        } catch {
          /* a tone that cannot be shaped is not worth interrupting a call for */
        }
      };
      // A blocked autoplay leaves the context suspended. resume() may reject, and that is fine.
      ctx.resume().catch(() => undefined);
      burst();
      timer = window.setInterval(burst, 1400);
    } catch {
      /* audio is a nicety, never a blocker */
    }
    return () => {
      stopped = true;
      window.clearInterval(timer);
      const context = ctx;
      if (context) {
        try {
          context.close().catch(() => undefined);
        } catch {
          /* already closed */
        }
      }
    };
  }, [active]);
}

/**
 * Who to call, and whether to call them with voice or video.
 *
 * The list is the same directory the new-chat panel searches, so there is one place in the app
 * where a person is chosen. People already in a direct chat are offered first, because they are
 * who a call is usually for.
 */
export function NewCallPanel({
  onClose,
  onPick,
  recents,
}: {
  onClose: () => void;
  /** One id for a one-to-one call, several for a group call. */
  onPick: (userIds: string[], kind: CallKind) => void;
  recents: PublicUser[];
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<CallKind>('audio');
  /* People added for a group call. Tapping a row still calls one person outright, so the
     common case stays a single tap and this is only for the second person onwards. */
  const [extra, setExtra] = useState<string[]>([]);
  const { results, searching } = useUserSearch(query);
  const searchingText = query.trim();
  const rows = searchingText ? results : recents;

  const toggleExtra = (userId: string) => {
    setExtra((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  return (
    <Sheet
      title={extra.length ? `Group call · ${extra.length + 1} people` : 'New call'}
      onClose={onClose}
    >
      <div className="call-kind">
        <button
          type="button"
          className={`filter-chip${kind === 'audio' ? ' on' : ''}`}
          onClick={() => setKind('audio')}
        >
          <IconPhone size={16} /> Voice
        </button>
        <button
          type="button"
          className={`filter-chip${kind === 'video' ? ' on' : ''}`}
          onClick={() => setKind('video')}
        >
          <IconVideoCall size={16} /> Video
        </button>
      </div>

      <div className="search-box" style={{ marginBottom: 12 }}>
        <IconSearch size={18} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, phone or username"
        />
      </div>

      {rows.length === 0 ? (
        <p className="hint">
          {searchingText
            ? searching
              ? 'Searching…'
              : `No one found for “${searchingText}”.`
            : 'No one to call yet. Search for someone, or start a chat with them first.'}
        </p>
      ) : (
        <>
          {!searchingText ? (
            <p className="hint" style={{ marginBottom: 8 }}>
              People you already chat with
            </p>
          ) : null}
          {rows.map((user) => {
            const chosen = extra.includes(user.id);
            return (
              <div key={user.id} className="pick-flex">
                <button
                  type="button"
                  className="pick-row"
                  onClick={() => onPick([user.id], kind)}
                >
                  <Avatar name={user.displayName} src={user.avatar} size={44} />
                  <span className="body">
                    <b>{user.displayName}</b>
                    <span>
                      {kind === 'video' ? 'Video call' : 'Voice call'} · {presence(user.lastSeen)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className={`pick-add${chosen ? ' on' : ''}`}
                  onClick={() => toggleExtra(user.id)}
                  title={chosen ? 'Remove from the group call' : 'Add to a group call'}
                >
                  {chosen ? <IconClose size={15} /> : <IconPlus size={15} />}
                </button>
              </div>
            );
          })}
        </>
      )}

      {extra.length ? (
        <div className="pick-footer">
          <span>
            {extra.length} {extra.length === 1 ? 'person' : 'people'} added
          </span>
          <button type="button" className="btn" onClick={() => onPick(extra, kind)}>
            {kind === 'video' ? 'Start video call' : 'Start voice call'}
          </button>
        </div>
      ) : null}
    </Sheet>
  );
}

/**
 * The Calls tab: who called whom, and a way to start one.
 *
 * The list is the model the updates and channels screens use — a head, a scrolling body, and
 * chat-item rows — because it is the same thing: an avatar, a name and two lines.
 */
export function CallsScreen({
  recents,
  onBack,
  onToast,
  onCall,
  starting,
}: {
  recents: PublicUser[];
  /** Back to chats. Only drawn on wide screens, where the tab bar is hidden. */
  onBack: () => void;
  onToast: (message: string) => void;
  onCall: (userIds: string[], kind: CallKind) => void;
  starting: boolean;
}) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [ready, setReady] = useState(false);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ calls: Call[] }>('/api/calls');
      setCalls(res.calls);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not load your calls');
    } finally {
      setReady(true);
    }
  }, [onToast]);

  useEffect(() => {
    load();
  }, [load]);

  /* Only worth polling while the screen is open, exactly as the updates feed is: the tab
     unmounts it the rest of the time, so the timer costs nothing. */
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [load]);

  function row(call: Call) {
    const state = call.missed ? 'Missed' : call.direction === 'outgoing' ? 'Outgoing' : 'Incoming';
    const kind = call.kind === 'video' ? 'video' : 'voice';
    const duration = call.durationMs === null ? '' : ` · ${clock(call.durationMs / 1000)}`;
    return (
      <button
        key={call.id}
        type="button"
        className="chat-item"
        disabled={starting}
        onClick={() => onCall([call.peer.id], call.kind)}
        title={`Call ${call.peer.displayName} again`}
      >
        <span className="call-face">
          <Avatar name={call.peer.displayName} src={call.peer.avatar} size={49} />
          <span className={`call-dir ${call.missed ? 'missed' : call.direction}`}>
            {call.missed ? (
              <IconPhoneMissed size={13} />
            ) : call.direction === 'outgoing' ? (
              <IconPhoneOutgoing size={13} />
            ) : (
              <IconPhoneIncoming size={13} />
            )}
          </span>
        </span>
        <span className="chat-item-body">
          <span className="chat-item-top">
            <span className="chat-item-name">{call.peer.displayName}</span>
            <span className={`chat-item-time${call.missed ? ' missed' : ''}`}>
              {relativeTime(call.createdAt)}
            </span>
          </span>
          <span className="chat-item-bottom">
            <span className={`chat-item-preview${call.missed ? ' missed' : ''}`}>
              {call.kind === 'video' ? <IconVideoCall size={14} /> : <IconPhone size={14} />}
              {`${state} ${kind} call${duration}`}
            </span>
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="updates">
      <div className="updates-head">
        <button type="button" className="updates-back" onClick={onBack} title="Back">
          <IconBack />
        </button>
        <h2>Calls</h2>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="ch-round"
          onClick={() => setPicking(true)}
          disabled={starting}
          title="New call"
        >
          <IconNewCall size={22} />
        </button>
      </div>

      <div className="updates-body">
        {!ready ? (
          <div className="loading">Loading your calls…</div>
        ) : calls.length === 0 ? (
          <div className="loading" style={{ flexDirection: 'column', gap: 10, padding: 28 }}>
            <span>No calls yet</span>
            <button type="button" className="btn" onClick={() => setPicking(true)}>
              Start a call
            </button>
          </div>
        ) : (
          calls.map(row)
        )}
      </div>

      {picking ? (
        <NewCallPanel
          recents={recents}
          onClose={() => setPicking(false)}
          onPick={(userIds, kind) => {
            setPicking(false);
            onCall(userIds, kind);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The call coming in: who it is, and the two ways to answer it.
 *
 * It takes the whole screen, because a call is not a thing to be left half-noticed in a corner.
 * The ringtone is tied to this component being mounted, so answering, declining — or the call
 * simply ageing out of the live read — stops it with no extra bookkeeping.
 */
export function IncomingCall({
  call,
  onAccept,
  onDecline,
}: {
  call: Call;
  onAccept: () => Promise<void>;
  onDecline: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  useRingtone(true);

  function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    void action().finally(() => setBusy(false));
  }

  return (
    <div className="call-full call-incoming">
      <div className="call-person">
        <Avatar name={call.peer.displayName} src={call.peer.avatar} size={124} />
        <b>{call.peer.displayName}</b>
        <span className="call-sub">
          {call.kind === 'video' ? 'Incoming video call' : 'Incoming voice call'}
        </span>
      </div>

      <div className="call-actions">
        <button
          type="button"
          className="call-btn decline"
          onClick={() => run(onDecline)}
          disabled={busy}
        >
          <IconCallEnd size={26} />
          <span>Decline</span>
        </button>
        <button
          type="button"
          className="call-btn accept"
          onClick={() => run(onAccept)}
          disabled={busy}
        >
          <IconPhone size={26} />
          <span>Accept</span>
        </button>
      </div>
    </div>
  );
}

/**
 * The call itself, in a window of its own.
 *
 * Both ends run the same component and the same negotiation: whoever started it makes the
 * offer, whoever answered makes the answer, and both trickle ICE candidates. There is no
 * WebSocket, so the offer, the answer and every candidate go through /signal and come back
 * through the signals poll, by cursor.
 *
 * The one rule this file exists to get right is the last one: the camera and the microphone are
 * released on hang up, on unmount, and when the other side disappears — `track.stop()` is the
 * only thing that turns the recording indicator off, and a call that ends without it leaves a
 * light on.
 */
/** One connection to one other person, and everything hanging off it. */
type PeerLink = {
  pc: RTCPeerConnection;
  /** Their tracks, once they start arriving. */
  stream: MediaStream;
  /** Candidates that arrived before there was a remote description to attach them to. */
  pending: RTCIceCandidateInit[];
  /** Set once a remote description exists, which is when addIceCandidate starts working. */
  ready: boolean;
};

/**
 * The other end's picture and sound.
 *
 * An element per peer, because a mesh has one stream per person. srcObject cannot be set as an
 * attribute — React has no prop for it — so it is attached in an effect.
 */
function PeerMedia({ stream, video }: { stream: MediaStream; video: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.srcObject === stream) return;
    el.srcObject = stream;
    // Autoplay with sound can be refused. The tap that got somebody here counts as the gesture,
    // so a rejection means the browser wanted something else, not that the audio is broken.
    el.play().catch(() => undefined);
  }, [stream]);
  // A voice call keeps the element in the tree, hidden — it is what plays the other person.
  return (
    <video
      ref={ref}
      className={video ? 'call-tile-video' : 'call-tile-audio'}
      autoPlay
      playsInline
    />
  );
}

/**
 * The in-call screen, for one-to-one and for group calls alike.
 *
 * One-to-one is the degenerate case of the mesh: two participants, so exactly one connection,
 * and the code does not need to know the difference. What it does need is to know who is on the
 * call, which comes from `call.participants` — the state per person, not just the list.
 *
 * Connections are opened to people who have *joined*, never to people still being rung: an
 * invitee has no media to send, so a connection to them would negotiate with nothing on the
 * other end and sit there dead until they answered or the ring expired.
 *
 * Each pair is negotiated once, by the side that loses the id comparison in
 * `shouldOffer`. Nothing is renegotiated — somebody joining opens one new connection on each
 * browser already in the call, and that is the only topology change there is.
 */
export function CallScreen({
  me,
  call,
  onEnded,
  onToast,
}: {
  me: PublicUser;
  call: Call;
  /** The call is over and this screen should go away. */
  onEnded: () => void;
  onToast: (message: string) => void;
}) {
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(call.kind === 'video');
  const [speaker, setSpeaker] = useState(false);
  const [swapped, setSwapped] = useState(false);
  /** Who we are actually connected to, for the connecting label. */
  const [livePeers, setLivePeers] = useState<string[]>([]);
  /** Each peer's media, so React can draw one element per person. */
  const [remotes, setRemotes] = useState<Record<string, MediaStream>>({});

  const localRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const linksRef = useRef<Map<string, PeerLink>>(new Map());
  /** Candidates whose peer has not been negotiated yet, held rather than dropped. */
  const orphanRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const iceRef = useRef<RTCIceServer[]>([]);
  const teardownRef = useRef<(() => void) | null>(null);
  const reconcileRef = useRef<(() => void) | null>(null);
  const hangUpRef = useRef<() => void>(() => undefined);
  const endedRef = useRef(false);

  const outgoing = call.callerId === me.id;
  const answeredAt = call.answeredAt;
  const video = call.kind === 'video';

  const others = joinedParticipants(call.participants).filter((p) => p.user.id !== me.id);
  const peerIds = activePeers(call.participants, me.id);
  // A stable key for "the people I should be connected to", so the reconcile effect runs when
  // that set changes and not on every poll — the call object is replaced every second.
  const peerKey = peerIds.slice().sort().join(',');

  /* Read by the long-lived effect below, which must not restart when the call object is
     replaced by the poll or when the toast callback changes identity. */
  const latestRef = useRef({ participants: call.participants, onToast });
  useEffect(() => {
    latestRef.current = { participants: call.participants, onToast };
  });

  /* Elapsed time, counted from answered_at, so both ends show the same number. */
  useEffect(() => {
    if (!answeredAt) return;
    const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - answeredAt) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [answeredAt]);

  /* One teardown, called from the hang-up button, the effect cleanup, and a connection that
     fails. Doing it twice is harmless. */
  const hangUp = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    teardownRef.current?.();
    teardownRef.current = null;
    // A two-person call ends; a larger one is only left, and carries on without you. Which of
    // the two this is depends on how many people are on the call, not on who is hanging up.
    const endpoint = hangUpEndpoint(latestRef.current.participants.length);
    // Tell the other end before this screen goes. A failure here is not worth reporting: the
    // live-call poll will notice the call is gone either way.
    void post(`/api/calls/${call.id}/${endpoint}`).catch(() => undefined);
    onEnded();
  }, [call.id, onEnded]);

  useEffect(() => {
    hangUpRef.current = hangUp;
  }, [hangUp]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let lastSeq = 0;

    const links = linksRef.current;
    const orphans = orphanRef.current;

    function clearPeer(peerId: string) {
      const link = links.get(peerId);
      if (!link) return;
      links.delete(peerId);
      try {
        link.pc.close();
      } catch {
        /* already closed */
      }
      orphans.delete(peerId);
      if (cancelled) return;
      setRemotes((prev) => {
        if (!(peerId in prev)) return prev;
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
      setLivePeers((prev) => prev.filter((id) => id !== peerId));
    }

    function stopEverything() {
      for (const peerId of [...links.keys()]) clearPeer(peerId);
      // The local stream is shared by every connection, so it is stopped once, here — never in
      // clearPeer, which would kill everybody else's audio with the first person who left.
      try {
        streamRef.current?.getTracks().forEach((track) => track.stop());
      } catch {
        /* nothing to stop */
      }
      streamRef.current = null;
      if (timer) window.clearInterval(timer);
      timer = 0;
      reconcileRef.current = null;
    }
    teardownRef.current = stopEverything;

    async function send(kind: CallSignal['kind'], payload: unknown, to?: string) {
      try {
        await post(`/api/calls/${call.id}/signal`, {
          kind,
          payload: JSON.stringify(payload),
          // Addressed at one peer. An ICE candidate in particular is meaningless to anybody
          // else, and unaddressed it would be read by every other participant as well.
          ...(to ? { to } : {}),
        });
      } catch {
        /* the call may have ended under us — the live-call poll will notice first */
      }
    }

    async function flush(link: PeerLink) {
      while (link.pending.length) {
        const init = link.pending.shift();
        if (!init) break;
        try {
          await link.pc.addIceCandidate(init);
        } catch {
          /* a candidate that arrives too late is useless, not an error */
        }
      }
    }

    function ensureLink(peerId: string): PeerLink | null {
      const existing = links.get(peerId);
      if (existing) return existing;
      const media = streamRef.current;
      if (!media) return null;

      const pc = new RTCPeerConnection({ iceServers: iceRef.current });
      const link: PeerLink = { pc, stream: new MediaStream(), pending: [], ready: false };
      links.set(peerId, link);

      for (const track of media.getTracks()) pc.addTrack(track, media);

      pc.onicecandidate = (event) => {
        if (event.candidate) void send('candidate', event.candidate.toJSON(), peerId);
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (!stream) return;
        link.stream = stream;
        if (!cancelled) setRemotes((prev) => ({ ...prev, [peerId]: stream }));
      };

      pc.onconnectionstatechange = () => {
        if (cancelled || endedRef.current) return;
        if (pc.connectionState === 'connected') {
          setLivePeers((prev) => (prev.includes(peerId) ? prev : [...prev, peerId]));
          return;
        }
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          const count = latestRef.current.participants.length;
          clearPeer(peerId);
          if (peerFailureEndsCall(count)) {
            // Nobody else to talk to. This is what the screen did before group calls, kept.
            hangUpRef.current();
          } else {
            // One bad connection must not take the call away from everybody still in it.
            latestRef.current.onToast('Lost the connection to one person on the call');
          }
        }
      };

      // Candidates that arrived before the offer did — the two travel as separate requests and
      // nothing guarantees the offer's finishes first.
      const queued = orphans.get(peerId);
      if (queued) {
        link.pending.push(...queued);
        orphans.delete(peerId);
      }

      return link;
    }

    async function applySignal(signal: CallSignal) {
      if (signal.fromId === me.id) return;
      const peerId = signal.fromId;

      // Only somebody on this call is worth negotiating with.
      if (!activePeers(latestRef.current.participants, me.id).includes(peerId)) return;

      if (signal.kind === 'candidate') {
        let init: RTCIceCandidateInit;
        try {
          init = JSON.parse(signal.payload) as RTCIceCandidateInit;
        } catch {
          return;
        }
        const link = links.get(peerId);
        if (!link) {
          const queue = orphans.get(peerId) ?? [];
          queue.push(init);
          orphans.set(peerId, queue);
          return;
        }
        // An ICE candidate applies only once a remote description is set. Applying one earlier
        // fails silently — no error, no connection — which is the classic WebRTC dead end.
        if (!link.ready) {
          link.pending.push(init);
          return;
        }
        try {
          await link.pc.addIceCandidate(init);
        } catch {
          /* too late to matter */
        }
        return;
      }

      let description: RTCSessionDescriptionInit;
      try {
        description = JSON.parse(signal.payload) as RTCSessionDescriptionInit;
      } catch {
        return;
      }

      if (signal.kind === 'offer') {
        // Never both sides for one pair: exactly one offers, decided by id in shouldOffer. So
        // there is no collision to recover from here — the "polite peer" case does not arise.
        const link = ensureLink(peerId);
        if (!link) return;
        try {
          await link.pc.setRemoteDescription(description);
        } catch {
          return;
        }
        link.ready = true;
        await flush(link);
        try {
          const answer = await link.pc.createAnswer();
          await link.pc.setLocalDescription(answer);
          await send('answer', { type: answer.type, sdp: answer.sdp }, peerId);
        } catch {
          /* the call ended mid-negotiation */
        }
        return;
      }

      // An answer, for an offer this side made.
      const link = links.get(peerId);
      if (!link) return;
      try {
        await link.pc.setRemoteDescription(description);
      } catch {
        return;
      }
      link.ready = true;
      await flush(link);
    }

    async function reconcilePeers() {
      if (cancelled || endedRef.current) return;
      const desired = activePeers(latestRef.current.participants, me.id);
      const { open, close } = reconcile([...links.keys()], desired);

      for (const peerId of close) clearPeer(peerId);

      for (const peerId of open) {
        // The designated side offers; the other waits for the offer already on its way. This is
        // what stops both ends creating a connection to each other.
        if (!shouldOffer(me.id, peerId)) continue;
        const link = ensureLink(peerId);
        if (!link) continue;
        try {
          const offer = await link.pc.createOffer();
          await link.pc.setLocalDescription(offer);
          await send('offer', { type: offer.type, sdp: offer.sdp }, peerId);
        } catch {
          /* the call ended mid-negotiation */
        }
      }
    }
    reconcileRef.current = reconcilePeers;

    async function poll() {
      if (cancelled || endedRef.current) return;
      try {
        const res = await api<{ signals: CallSignal[] }>(
          `/api/calls/${call.id}/signals?after=${lastSeq}`
        );
        for (const signal of res.signals) {
          lastSeq = Math.max(lastSeq, signal.seq);
          await applySignal(signal);
        }
      } catch {
        /* a poll that fails is retried on the next tick */
      }
    }

    async function start() {
      try {
        // ICE first, so a deployment with TURN gets one allocation rather than a failed attempt
        // followed by a retry.
        const ice = await api<{ iceServers: RTCIceServer[] }>('/api/calls/ice');
        iceRef.current = ice.iceServers;
        const media = await navigator.mediaDevices.getUserMedia(
          video ? { audio: true, video: true } : { audio: true }
        );
        // The call can end while the permission prompt is up. Whoever stopped it wins.
        if (cancelled || endedRef.current) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = media;
        if (localRef.current) {
          localRef.current.srcObject = media;
          localRef.current.play().catch(() => undefined);
        }

        await reconcilePeers();

        timer = window.setInterval(() => void poll(), 1000);
        void poll();
      } catch (err) {
        if (cancelled) return;
        latestRef.current.onToast(err instanceof Error ? err.message : 'Could not start the call');
        hangUpRef.current();
      }
    }

    void start();

    return () => {
      cancelled = true;
      stopEverything();
      teardownRef.current = null;
    };
    // Keyed on the call's identity and this end's role, not on the call object, which the poll
    // replaces every second — and not on the participant list, which would tear down every
    // connection each time somebody joined. The effect below handles those changes instead.
  }, [call.id, call.kind, call.callerId, me.id, video]);

  /* Somebody joined or left: open or close exactly the connections that changed. This is the
     only place the mesh's shape is decided after the call starts. */
  useEffect(() => {
    void reconcileRef.current?.();
  }, [peerKey]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      streamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = !next;
      });
      return next;
    });
  }, []);

  const toggleCamera = useCallback(() => {
    setCameraOn((prev) => {
      const next = !prev;
      streamRef.current?.getVideoTracks().forEach((track) => {
        track.enabled = next;
      });
      return next;
    });
  }, []);

  const toggleSpeaker = useCallback(() => {
    const next = !speaker;
    setSpeaker(next);
    /* Best effort, and applied to every element rather than one: setSinkId needs an output
       device id, is absent from mobile Safari, and can reject even where it exists — so the
       toggle moves either way, because that is the only feedback a phone can give. */
    const elements = document.querySelectorAll<HTMLMediaElement>('.call-tile-audio, .call-tile-video');
    if (!elements.length) return;
    void (async () => {
      try {
        const sink = !next
          ? ''
          : ((
              await navigator.mediaDevices.enumerateDevices()
            ).filter((d) => d.kind === 'audiooutput').find((d) => /speaker|default/i.test(d.label))
              ?.deviceId ?? '');
        for (const el of Array.from(elements)) {
          const withSink = el as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
          if (typeof withSink.setSinkId !== 'function') continue;
          await withSink.setSinkId(sink).catch(() => undefined);
        }
      } catch {
        /* the toggle itself is the fallback */
      }
    })();
  }, [speaker]);

  const waitingForAnyone = others.length === 0;
  const status = !answeredAt
    ? outgoing
      ? 'Ringing…'
      : 'Connecting…'
    : `${clock(seconds)}${
        waitingForAnyone
          ? ' · waiting for others'
          : livePeers.length === 0
            ? ' · connecting'
            : ''
      }`;

  return (
    <div className="call-full call-live">
      <div className={`call-stage${video ? '' : ' voice'}${swapped ? ' swapped' : ''}`}>
        {waitingForAnyone ? (
          <div className="call-person">
            <Avatar name={call.peer.displayName} src={call.peer.avatar} size={132} />
            <p className="call-sub">Waiting for someone to join…</p>
          </div>
        ) : (
          <div className={`call-grid${others.length > 1 ? ' many' : ''}`}>
            {others.map((p) => {
              const stream = remotes[p.user.id];
              return (
                <div key={p.user.id} className="call-tile">
                  {/* Sound always comes from an element, even on a voice call — hidden, but in
                      the tree, because that is what plays them. */}
                  {stream ? <PeerMedia stream={stream} video={video} /> : null}
                  {!video || !stream ? (
                    <div className="call-tile-face">
                      <Avatar
                        name={p.user.displayName}
                        src={p.user.avatar}
                        size={others.length > 2 ? 54 : 128}
                      />
                    </div>
                  ) : null}
                  <span className="call-tile-name">{p.user.displayName}</span>
                </div>
              );
            })}
          </div>
        )}

        {video ? (
          <button
            type="button"
            className="call-local"
            onClick={() => setSwapped((prev) => !prev)}
            title="Swap views"
          >
            <video ref={localRef} autoPlay playsInline muted />
          </button>
        ) : null}
      </div>

      <div className="call-top">
        <b>{describeCall(call, me.id)}</b>
        <span>{status}</span>
      </div>

      <div className="call-controls">
        <button
          type="button"
          className={`call-ctl${muted ? ' on' : ''}`}
          onClick={toggleMute}
          title={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <IconMicOff size={22} /> : <IconMic size={22} />}
          <span>{muted ? 'Unmute' : 'Mute'}</span>
        </button>
        <button
          type="button"
          className={`call-ctl${speaker ? ' on' : ''}`}
          onClick={toggleSpeaker}
          title="Speaker"
        >
          {speaker ? <IconSpeaker size={22} /> : <IconSpeakerOff size={22} />}
          <span>Speaker</span>
        </button>
        {video ? (
          <button
            type="button"
            className={`call-ctl${cameraOn ? ' on' : ''}`}
            onClick={toggleCamera}
            title="Camera"
          >
            {cameraOn ? <IconVideoCall size={22} /> : <IconVideoOff size={22} />}
            <span>Camera</span>
          </button>
        ) : null}
        <button
          type="button"
          className="call-ctl end"
          onClick={hangUp}
          title={others.length ? 'Hang up' : 'Cancel'}
        >
          <IconCallEnd size={22} />
          <span>{others.length ? 'Hang up' : 'Cancel'}</span>
        </button>
      </div>
    </div>
  );
}
