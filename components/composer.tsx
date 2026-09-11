'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReplyDraft } from './messenger';
import { EmojiPanel } from './emoji';
import { IconAttach, IconClose, IconEmoji, IconSend } from './icons';

export function Composer({
  sending,
  reply,
  onClearReply,
  onSend,
}: {
  sending: boolean;
  reply: ReplyDraft;
  onClearReply: () => void;
  onSend: (text: string, image?: File | null) => void;
}) {
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (reply) areaRef.current?.focus();
  }, [reply]);

  function submit() {
    const body = text.trim();
    if (!body && !file) return;
    if (sending) return;
    onSend(body, file);
    setText('');
    setFile(null);
    setEmoji(false);
  }

  return (
    <>
      {preview ? (
        <div className="attach-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Attachment preview" />
          <div className="info">
            <b>Photo ready to send</b>
            <div className="hint">{file?.name}</div>
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

      <div className="composer">
        <button
          type="button"
          className={`icon-btn${emoji ? ' on' : ''}`}
          title="Emoji"
          onClick={() => setEmoji((v) => !v)}
        >
          <IconEmoji />
        </button>

        <button
          type="button"
          className="icon-btn"
          title="Attach a photo"
          onClick={() => fileRef.current?.click()}
        >
          <IconAttach />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            setFile(picked);
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
                borderLeft: '3px solid var(--brand)',
                padding: '3px 8px',
                marginBottom: 4,
                borderRadius: 4,
                background: 'rgba(124,92,255,.12)',
                fontSize: 12.6,
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ color: 'var(--brand)' }}>{reply.senderName}</b>
                <span style={{ color: 'var(--muted)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>

        <button
          type="button"
          className="send-btn"
          onClick={submit}
          disabled={sending || (!text.trim() && !file)}
          title="Send"
        >
          <IconSend size={20} />
        </button>
      </div>
    </>
  );
}
