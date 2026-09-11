'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { IconPause, IconPlay } from './icons';

/** Deterministic pseudo-waveform so a clip always renders the same shape. */
function barsFor(seed: string, count = 30): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 99991;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    h = (h * 1103515245 + 12345) % 2147483648;
    out.push(6 + (h % 18));
  }
  return out;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function VoiceNote({ src, sec }: { src: string; sec: number }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(sec);
  const bars = useMemo(() => barsFor(src), [src]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setPosition(el.currentTime);
    const onMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
    };
    const onEnd = () => {
      setPlaying(false);
      setPosition(0);
    };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnd);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('ended', onEnd);
    };
  }, []);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      el.play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    }
  }

  function seek(ratio: number) {
    const el = audioRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    el.currentTime = ratio * el.duration;
    setPosition(el.currentTime);
  }

  const ratio = duration > 0 ? Math.min(1, position / duration) : 0;
  const shown = playing || position > 0 ? position : duration;

  return (
    <div className="voice">
      <button type="button" className="play" onClick={toggle} title={playing ? 'Pause' : 'Play'}>
        {playing ? <IconPause size={15} /> : <IconPlay size={15} />}
      </button>
      <div
        className="wave"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          seek((e.clientX - rect.left) / rect.width);
        }}
        role="presentation"
      >
        {bars.map((height, i) => (
          <i
            key={i}
            className={i / bars.length <= ratio ? 'on' : ''}
            style={{ height: `${height}px` }}
          />
        ))}
      </div>
      <span className="dur">{clock(shown)}</span>
      <audio ref={audioRef} src={src} preload="metadata" />
    </div>
  );
}
