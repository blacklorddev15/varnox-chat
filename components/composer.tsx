'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReplyDraft } from './messenger';
import { EmojiPanel } from './emoji';
import {
  IconAttach,
  IconCamera,
  IconClose,
  IconDoc,
  IconEmoji,
  IconImage,
  IconMic,
  IconSend,
} from './icons';

export type Outgoing = {
  text: string;
  image?: File | null;
  audio?: { blob: Blob; sec: number } | null;
  file?: File | null;
};

export function Composer({
  sending,
  reply,
  onClearReply,
  onSend,
  onTyping,
  blocked,
}: {
  sending: boolean;
  reply: ReplyDraft;
  onClearReply: () => void;
  onSend: (payload: Outgoing) => void;
  onTyping: () => void;
  blocked: boolean;
}) {
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [error, setError] = useState('');

  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
  }, [text]);

  useEffect(() => {
    if (!image) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  useEffect(() => {
    if (reply) areaRef.current?.focus();
  }, [reply]);

  function submit() {
    const body = text.trim();
    if (sending) return;
    if (!body && !image && !file) return;
    onSend({ text: body, image, file });
    setText('');
    setImage(null);
    setFile(null);
    setEmoji(false);
  }

  /* ------------------------------------------------------------- voice */

  async function startRecording() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        // Strip ";codecs=…" from what the recorder reports — the upload endpoint matches on
        // the bare media type, and "audio/webm;codecs=opus" is not "audio/webm".
        const recorded = (recorder.mimeType || 'audio/webm').split(';')[0].trim() || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: recorded });
        const sec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        if (blob.size > 0) onSend({ text: '', audio: { blob, sec } });
      };
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start();
      setRecording(true);
      setRecordSec(0);
      tickRef.current = window.setInterval(
        () => setRecordSec(Math.round((Date.now() - startedAtRef.current) / 1000)),
        500
      );
    } catch {
      setError('Microphone permission was refused');
    }
  }

  function stopRecording(send: boolean) {
    const recorder = recorderRef.current;
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = null;
    setRecording(false);
    if (!recorder) return;
    if (!send) recorder.onstop = null;
    if (recorder.state !== 'inactive') recorder.stop();
    recorderRef.current = null;
  }

  useEffect(() => () => stopRecording(false), []);

  if (blocked) {
    return (
      <div className="composer" style={{ justifyContent: 'center' }}>
        <span className="hint">You blocked this contact. Unblock them in the contact info to chat.</span>
      </div>
    );
  }

  if (recording) {
    return (
      <div className="rec-bar">
        <button type="button" className="icon-btn" onClick={() => stopRecording(false)} title="Cancel">
          <IconClose />
        </button>
        <span className="rec-dot" />
        <span className="rec-time">
          {Math.floor(recordSec / 60)}:{String(recordSec % 60).padStart(2, '0')}
        </span>
        <span className="hint" style={{ flex: 1 }}>
          Recording voice message…
        </span>
        <button type="button" className="send-btn" onClick={() => stopRecording(true)} title="Send">
          <IconSend size={20} />
        </button>
      </div>
    );
  }

  return (
    <>
      {preview ? (
        <div className="attach-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Attachment preview" />
          <div className="info">
            <b>Photo ready to send</b>
            <div className="hint">{image?.name}</div>
          </div>
          <button type="button" className="icon-btn" onClick={() => setImage(null)} title="Remove">
            <IconClose />
          </button>
        </div>
      ) : null}

      {file ? (
        <div className="attach-preview">
          <span className="ic" style={{ width: 52, height: 52, display: 'grid', placeItems: 'center' }}>
            <IconDoc size={26} />
          </span>
          <div className="info">
            <b>{file.name}</b>
            <div className="hint">{Math.max(1, Math.round(file.size / 1024))} KB</div>
          </div>
          <button type="button" className="icon-btn" onClick={() => setFile(null)} title="Remove">
            <IconClose />
          </button>
        </div>
      ) : null}

      {emoji ? (
        <EmojiPanel
          onPick={(e) => {
            setText((t) => t + e);
            areaRef.current?.focus();
          }}
        />
      ) : null}

      {error ? (
        <div className="hint" style={{ padding: '6px 16px', color: 'var(--danger)' }}>
          {error}
        </div>
      ) : null}

      <div className="composer">
        <button
          type="button"
          className={`icon-btn${emoji ? ' on' : ''}`}
          title="Emoji"
          onClick={() => {
            setEmoji((v) => !v);
            setAttachOpen(false);
          }}
        >
          <IconEmoji />
        </button>

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className={`icon-btn${attachOpen ? ' on' : ''}`}
            title="Attach"
            onClick={() => {
              setAttachOpen((v) => !v);
              setEmoji(false);
            }}
          >
            <IconAttach />
          </button>
          {attachOpen ? (
            <div className="menu" style={{ top: 'auto', bottom: 52, minWidth: 190 }}>
              <button
                type="button"
                onClick={() => {
                  setAttachOpen(false);
                  imageRef.current?.click();
                }}
              >
                <IconImage size={18} /> Photos
              </button>
              <button
                type="button"
                onClick={() => {
                  setAttachOpen(false);
                  fileRef.current?.click();
                }}
              >
                <IconDoc size={18} /> Document
              </button>
              <button
                type="button"
                onClick={() => {
                  setAttachOpen(false);
                  imageRef.current?.click();
                }}
              >
                <IconCamera size={18} /> Camera
              </button>
            </div>
          ) : null}
        </div>

        <input
          ref={imageRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => {
            setImage(e.target.files?.[0] ?? null);
            setFile(null);
            e.target.value = '';
          }}
        />
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setImage(null);
            e.target.value = '';
          }}
        />

        <div className="field" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          {reply ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                borderLeft: '4px solid var(--brand)',
                padding: '3px 8px',
                marginBottom: 4,
                borderRadius: 4,
                background: 'rgba(18,168,126,.12)',
                fontSize: 13,
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ color: 'var(--brand-strong)' }}>{reply.senderName}</b>
                <span
                  style={{
                    color: 'var(--muted)',
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {reply.text || 'Photo'}
                </span>
              </span>
              <button type="button" className="icon-btn" onClick={onClearReply} title="Cancel reply">
                <IconClose size={16} />
              </button>
            </div>
          ) : null}
          <textarea
            ref={areaRef}
            rows={1}
            value={text}
            placeholder="Type a message"
            onChange={(e) => {
              setText(e.target.value);
              onTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>

        {text.trim() || image || file ? (
          <button type="button" className="send-btn" onClick={submit} disabled={sending} title="Send">
            <IconSend size={20} />
          </button>
        ) : (
          <button type="button" className="send-btn" onClick={startRecording} title="Record voice message">
            <IconMic size={21} />
          </button>
        )}
      </div>
    </>
  );
}
