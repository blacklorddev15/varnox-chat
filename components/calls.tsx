'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, post } from '@/lib/client';
import type { Call, CallSignal, PublicUser } from '@/lib/types';
import { presence, relativeTime } from '@/lib/format';
import { Avatar } from './avatar';
import { Sheet, useUserSearch } from './panels';
import {
  IconBack,
  IconCallEnd,
  IconMic,
  IconMicOff,
  IconNewCall,
  IconPhone,
  IconPhoneIncoming,
  IconPhoneMissed,
  IconPhoneOutgoing,
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
  onPick: (userId: string, kind: CallKind) => void;
  recents: PublicUser[];
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<CallKind>('audio');
  const { results, searching } = useUserSearch(query);
  const searchingText = query.trim();
  const rows = searchingText ? results : recents;

  return (
    <Sheet title="New call" onClose={onClose}>
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
          {rows.map((user) => (
            <button
              key={user.id}
              type="button"
              className="pick-row"
              onClick={() => onPick(user.id, kind)}
            >
              <Avatar name={user.displayName} src={user.avatar} size={44} />
              <span className="body">
                <b>{user.displayName}</b>
                <span>
                  {kind === 'video' ? 'Video call' : 'Voice call'} · {presence(user.lastSeen)}
                </span>
              </span>
            </button>
          ))}
        </>
      )}
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
  onCall: (userId: string, kind: CallKind) => void;
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
        onClick={() => onCall(call.peer.id, call.kind)}
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
          onPick={(userId, kind) => {
            setPicking(false);
            onCall(userId, kind);
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
  const [connected, setConnected] = useState(false);

  const localRef = useRef<HTMLVideoElement | null>(null);
  const remoteRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const endedRef = useRef(false);

  const outgoing = call.callerId === me.id;
  const answeredAt = call.answeredAt;

  /* Elapsed time, counted from answered_at, so both ends show the same number. Before it is
     answered there is nothing to count, and the label says what is happening instead. */
  useEffect(() => {
    if (!answeredAt) return;
    const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - answeredAt) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [answeredAt]);

  /* One teardown, called from three places: the hang-up button, the effect cleanup, and a
     connection that fails or closes on its own. Doing it twice is harmless. */
  const hangUp = useCallback(() => {
    endedRef.current = true;
    cleanupRef.current?.();
    cleanupRef.current = null;
    // Tell the other end, and record the duration, before this screen goes. A failure here is
    // not worth reporting: the live-call poll will notice the call is gone either way.
    void post(`/api/calls/${call.id}/end`).catch(() => undefined);
    onEnded();
  }, [call.id, onEnded]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let lastSeq = 0;
    /** Candidates that arrived before there was a remote description to attach them to. */
    const pending: RTCIceCandidateInit[] = [];
    let remoteReady = false;

    function stopEverything() {
      try {
        streamRef.current?.getTracks().forEach((track) => track.stop());
      } catch {
        /* nothing to stop */
      }
      streamRef.current = null;
      try {
        pcRef.current?.close();
      } catch {
        /* already closed */
      }
      pcRef.current = null;
      if (timer) window.clearInterval(timer);
      timer = 0;
    }
    cleanupRef.current = stopEverything;

    async function send(kind: CallSignal['kind'], payload: unknown) {
      try {
        await post(`/api/calls/${call.id}/signal`, { kind, payload: JSON.stringify(payload) });
      } catch {
        /* the call may have ended under us — the live-call poll will notice first */
      }
    }

    function showRemote(stream: MediaStream) {
      const el = remoteRef.current;
      if (!el) return;
      el.srcObject = stream;
      el.play().catch(() => undefined);
      setConnected(true);
    }

    /** Attach the candidates that were waiting for a remote description. */
    async function flushPending(pc: RTCPeerConnection, queue: RTCIceCandidateInit[]) {
      while (queue.length) {
        const init = queue.shift();
        if (!init) break;
        try {
          await pc.addIceCandidate(init);
        } catch {
          /* a candidate that arrives too late is useless, not an error */
        }
      }
    }

    async function applySignal(signal: CallSignal) {
      const pc = pcRef.current;
      if (!pc || signal.fromId === me.id) return;

      if (signal.kind === 'candidate') {
        let init: RTCIceCandidateInit;
        try {
          init = JSON.parse(signal.payload) as RTCIceCandidateInit;
        } catch {
          return;
        }
        // An ICE candidate applies only once a remote description is set. Applying one earlier
        // fails silently — no error, no connection — which is the classic WebRTC dead end, so
        // these wait here and are flushed the moment there is a description to add them to.
        if (!remoteReady) {
          pending.push(init);
          return;
        }
        try {
          await pc.addIceCandidate(init);
        } catch {
          /* a candidate that arrives too late is useless, not an error */
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
        if (outgoing) return; // the caller makes the offer; a stray one from it is ignored
        try {
          await pc.setRemoteDescription(description);
        } catch {
          return;
        }
        remoteReady = true;
        await flushPending(pc, pending);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await send('answer', { type: answer.type, sdp: answer.sdp });
        return;
      }

      if (!outgoing) return; // only the caller expects an answer
      try {
        await pc.setRemoteDescription(description);
      } catch {
        return;
      }
      remoteReady = true;
      await flushPending(pc, pending);
    }

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
        // ICE first, so a deployment with TURN gets one allocation rather than a failed
        // attempt followed by a retry.
        const ice = await api<{ iceServers: RTCIceServer[] }>('/api/calls/ice');
        const media = await navigator.mediaDevices.getUserMedia(
          call.kind === 'video' ? { audio: true, video: true } : { audio: true }
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

        const pc = new RTCPeerConnection({ iceServers: ice.iceServers });
        pcRef.current = pc;
        for (const track of media.getTracks()) pc.addTrack(track, media);

        pc.onicecandidate = (event) => {
          if (event.candidate) void send('candidate', event.candidate.toJSON());
        };
        pc.ontrack = (event) => {
          const stream = event.streams[0];
          if (stream) showRemote(stream);
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'connected') setConnected(true);
          // A connection that fails or closes is a call that is over, whether or not anybody
          // tapped anything — the other side may simply have gone away.
          if (
            !cancelled &&
            !endedRef.current &&
            (pc.connectionState === 'failed' || pc.connectionState === 'closed')
          ) {
            hangUp();
          }
        };

        if (outgoing) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await send('offer', { type: offer.type, sdp: offer.sdp });
        }

        timer = window.setInterval(() => void poll(), 1000);
        void poll();
      } catch (err) {
        if (cancelled) return;
        onToast(err instanceof Error ? err.message : 'Could not start the call');
        hangUp();
      }
    }

    void start();

    return () => {
      cancelled = true;
      stopEverything();
      cleanupRef.current = null;
    };
    // Keyed on the call's identity and this end's role, not on the call object, which the poll
    // replaces every second — a negotiation is not restarted by a status field changing.
  }, [call.id, call.kind, call.callerId, me.id, outgoing, hangUp, onToast]);

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
    /* Best effort. setSinkId needs an output device id, is absent from mobile Safari, and can
       reject even where it exists — so the toggle moves either way, because that is the only
       feedback a phone can give. */
    const el = remoteRef.current as
      | (HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> })
      | null;
    if (!el || typeof el.setSinkId !== 'function') return;
    void (async () => {
      try {
        if (!next) {
          await el.setSinkId('');
          return;
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        const outputs = devices.filter((device) => device.kind === 'audiooutput');
        const chosen = outputs.find((device) => /speaker|default/i.test(device.label)) ?? outputs[0];
        if (chosen) await el.setSinkId(chosen.deviceId);
      } catch {
        /* the toggle itself is the fallback */
      }
    })();
  }, [speaker]);

  const video = call.kind === 'video';
  const status = answeredAt
    ? `${clock(seconds)}${connected ? '' : ' · connecting'}`
    : outgoing
      ? 'Ringing…'
      : 'Connecting…';

  return (
    <div className="call-full call-live">
      <div className={`call-stage${video ? '' : ' voice'}${swapped ? ' swapped' : ''}`}>
        {/* The remote element is always a video element: for a voice call it is hidden by CSS,
            and a hidden element still plays, which is what carries the other person's audio. */}
        <video ref={remoteRef} className="call-remote" autoPlay playsInline />
        {video ? (
          <button
            type="button"
            className="call-local"
            onClick={() => setSwapped((prev) => !prev)}
            title="Swap views"
          >
            <video ref={localRef} autoPlay playsInline muted />
          </button>
        ) : (
          <div className="call-person">
            <Avatar name={call.peer.displayName} src={call.peer.avatar} size={132} />
          </div>
        )}
      </div>

      <div className="call-top">
        <b>{call.peer.displayName}</b>
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
        <button type="button" className="call-ctl end" onClick={hangUp} title="Hang up">
          <IconCallEnd size={22} />
          <span>Hang up</span>
        </button>
      </div>
    </div>
  );
}
