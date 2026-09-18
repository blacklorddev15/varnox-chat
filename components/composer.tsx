'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReplyDraft } from './messenger';
import { EmojiPanel } from './emoji';
import {
  IconAttach,
  IconCamera,
  IconClose,
  IconContact,
  IconDoc,
  IconEmoji,
  IconImage,
  IconLocation,
  IconMic,
  IconSend,
} from './icons';

export type Outgoing = {
  text: string;
  image?: File | null;
  audio?: { blob: Blob; sec: number } | null;
  file?: File | null;
  /** A shared location pin; coordinates come from the geolocation API. */
  location?: { lat: number; lng: number };
  /** A shared contact card. */
  contact?: { name: string; phone: string };
  once?: boolean;
};

export function Composer({
  sending,
  reply,
  onClearReply,
  onSend,
  onTyping,
  blocked,
  recentMedia,
}: {
  sending: boolean;
  reply: ReplyDraft;
  onClearReply: () => void;
  onSend: (payload: Outgoing) => void | Promise<void>;
  onTyping: () => void;
  blocked: boolean;
  /** Pictures already sent in this chat, newest first. */
  recentMedia?: string[];
}) {
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  /** Images chosen from the gallery, held open in the picker until they are sent or dropped. */
  const [gallery, setGallery] = useState<File[]>([]);
  const [gallerySel, setGallerySel] = useState<boolean[]>([]);
  const [galleryUrls, setGalleryUrls] = useState<string[]>([]);
  const [galleryCaption, setGalleryCaption] = useState('');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [viewOnce, setViewOnce] = useState(false);
  const [error, setError] = useState('');
  const [contactOpen, setContactOpen] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
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

  useEffect(() => {
    const urls = gallery.map((f) => URL.createObjectURL(f));
    setGalleryUrls(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [gallery]);

  function closeGallery() {
    setGalleryOpen(false);
    setGallery([]);
    setGallerySel([]);
    setGalleryCaption('');
  }

  /**
   * Sends each selected image as its own message, in order, with the caption on the first.
   *
   * Sequential, and awaited, on purpose. send() in messenger refuses a second call while one is
   * already in flight, so firing these together would silently post only the first image and
   * drop the rest with no error anywhere.
   */
  async function sendGallery() {
    const chosen = gallery.filter((_, i) => gallerySel[i]);
    if (!chosen.length || sending) return;
    const caption = galleryCaption.trim();
    const once = viewOnce;
    closeGallery();
    setViewOnce(false);
    for (let i = 0; i < chosen.length; i += 1) {
      await onSend({ text: i === 0 ? caption : '', image: chosen[i], once });
    }
  }

  /**
   * Reuses a picture already sent in this chat.
   *
   * The app only holds its URL, and the upload path wants a File, so it is fetched back and
   * wrapped. It then goes through exactly the same picker as a freshly chosen image.
   */
  async function useRecent(url: string) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const file = new File([blob], 'recent', { type: blob.type || 'image/jpeg' });
      closeSheet();
      setImage(null);
      setFile(null);
      setGallery([file]);
      setGallerySel([true]);
      setGalleryOpen(true);
    } catch {
      setError('That picture could not be loaded.');
    }
  }

  function submit() {
    const body = text.trim();
    if (sending) return;
    if (!body && !image && !file) return;
    onSend({ text: body, image, file, once: viewOnce });
    setText('');
    setImage(null);
    setFile(null);
    setEmoji(false);
    setViewOnce(false);
  }

  /* ---------------------------------------------------- attachment sheet */

  function openSheet() {
    setAttachOpen(true);
    setEmoji(false);
    setError('');
  }

  function closeSheet() {
    setAttachOpen(false);
    setContactOpen(false);
    setContactName('');
    setContactPhone('');
  }

  /** Close the sheet, then open the picker — otherwise the sheet covers the dialog. */
  function pickWith(open: () => void) {
    closeSheet();
    open();
  }

  /**
   * Never sends without real coordinates: unsupported, refused or a non-finite fix all end
   * in the error slot instead of a message with made-up numbers in it.
   */
  function sendLocation() {
    setError('');
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Location is not supported on this device');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude);
        const lng = Number(pos.coords.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          setError('Could not read your coordinates');
          return;
        }
        closeSheet();
        onSend({ text: '', location: { lat, lng } });
      },
      () => setError('Location permission was refused'),
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }

  function submitContact() {
    const name = contactName.trim();
    const phone = contactPhone.trim();
    if (!name || !phone) {
      setError('A contact needs a name and a phone number');
      return;
    }
    setError('');
    const draft = { name, phone };
    closeSheet();
    onSend({ text: '', contact: draft });
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
        if (blob.size > 0) {
          onSend({ text: '', audio: { blob, sec }, once: viewOnce });
          setViewOnce(false);
        }
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

  const onceBadge = (
    <span
      style={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        border: '1.5px solid currentColor',
        display: 'grid',
        placeItems: 'center',
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      1
    </span>
  );

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
          onClose={() => setEmoji(false)}
          onBackspace={() => setText((t) => t.slice(0, -1))}
        />
      ) : null}

      {error ? (
        <div className="hint" style={{ padding: '6px 16px', color: 'var(--danger)' }}>
          {error}
        </div>
      ) : null}

      {attachOpen ? (
        <div className="attach-sheet">
          {recentMedia && recentMedia.length ? (
            <>
              <p className="emoji-section">Recent in this chat</p>
              <div className="recent-strip">
                {recentMedia.map((u) => (
                  <button
                    key={u}
                    type="button"
                    className="recent-cell"
                    onClick={() => useRecent(u)}
                    aria-label="Reuse this picture"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" />
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {contactOpen ? (
            <form
              className="attach-contact"
              onSubmit={(e) => {
                e.preventDefault();
                submitContact();
              }}
            >
              <div className="attach-contact-fields">
                <input
                  className="input"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Name"
                  maxLength={80}
                  autoFocus
                />
                <input
                  className="input"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="Phone"
                  inputMode="tel"
                />
              </div>
              <div className="attach-contact-actions">
                <button type="button" className="btn ghost" onClick={() => setContactOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn">
                  Send contact
                </button>
              </div>
            </form>
          ) : (
            <div className="attach-tiles">
              <button
                type="button"
                className="attach-tile"
                onClick={() => pickWith(() => fileRef.current?.click())}
              >
                <span className="attach-ic">
                  <IconDoc size={22} />
                </span>
                <span>Document</span>
              </button>
              <button
                type="button"
                className="attach-tile"
                onClick={() => pickWith(() => imageRef.current?.click())}
              >
                <span className="attach-ic">
                  <IconImage size={22} />
                </span>
                <span>Gallery</span>
              </button>
              <button
                type="button"
                className="attach-tile"
                onClick={() => pickWith(() => cameraRef.current?.click())}
              >
                <span className="attach-ic">
                  <IconCamera size={22} />
                </span>
                <span>Camera</span>
              </button>
              <button type="button" className="attach-tile" onClick={sendLocation}>
                <span className="attach-ic">
                  <IconLocation size={22} />
                </span>
                <span>Location</span>
              </button>
              <button
                type="button"
                className="attach-tile"
                onClick={() => {
                  setError('');
                  setContactOpen(true);
                }}
              >
                <span className="attach-ic">
                  <IconContact size={22} />
                </span>
                <span>Contact</span>
              </button>
            </div>
          )}
        </div>
      ) : null}

      <div className="composer">
        {/* The gallery takes several at once and hands them to the picker overlay, where the
            caption, the view-once flag and the send button live. The camera input below stays
            single-shot and uses the inline preview, because a camera capture is one picture. */}
        <input
          ref={imageRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (!files.length) return;
            setImage(null);
            setFile(null);
            setGallery(files);
            setGallerySel(files.map(() => true));
            setGalleryOpen(true);
          }}
        />
        {/* Separate from the gallery input: capture makes a phone open the camera directly. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          capture="environment"
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
          {/* Everything except the microphone sits inside the pill: emoji on the left, the
              field in the middle, and the trailing icons hard right. The mic stays outside as
              its own round button, which is what gives the bar its shape. */}
          <div className="composer-row">
            <button
              type="button"
              className={`icon-btn${emoji ? ' on' : ''}`}
              title="Emoji"
              onClick={() => {
                setEmoji((v) => !v);
                closeSheet();
              }}
            >
              <IconEmoji />
            </button>

            <textarea
              ref={areaRef}
              rows={1}
              value={text}
              placeholder="Message"
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

            <button
              type="button"
              className={`icon-btn${viewOnce ? ' on' : ''}`}
              title="View once"
              onClick={() => setViewOnce((v) => !v)}
            >
              {onceBadge}
            </button>

            <button
              type="button"
              className={`icon-btn${attachOpen ? ' on' : ''}`}
              title="Attach"
              onClick={() => (attachOpen ? closeSheet() : openSheet())}
            >
              <IconAttach />
            </button>

            {/* Straight to the camera, skipping the sheet. The sheet still has a Camera tile for
                when the input is already open. */}
            <button
              type="button"
              className="icon-btn"
              title="Camera"
              onClick={() => cameraRef.current?.click()}
            >
              <IconCamera />
            </button>
          </div>
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

      {/* What was picked, a caption and the send button, over everything. The grid here is the
          images this app was handed in the OS picker — a website cannot read the phone's photo
          library, so there is no "Recents" set to show behind it. */}
      {galleryOpen ? (
        <div className="picker">
          <div className="picker-top">
            <button
              type="button"
              className="emoji-ic"
              onClick={closeGallery}
              title="Cancel"
              aria-label="Cancel"
            >
              <IconClose size={18} />
            </button>
            <h3 className="picker-title">
              {gallerySel.filter(Boolean).length} selected
            </h3>
          </div>

          <div className="picker-grid">
            {galleryUrls.map((url, i) => (
              <button
                key={url}
                type="button"
                className={`picker-cell${gallerySel[i] ? ' on' : ''}`}
                onClick={() =>
                  setGallerySel((sel) => sel.map((v, j) => (j === i ? !v : v)))
                }
                aria-label={`Image ${i + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" />
                {gallerySel[i] ? (
                  <span className="picker-badge">
                    {gallerySel.slice(0, i + 1).filter(Boolean).length}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="picker-bar">
            <button
              type="button"
              className={`icon-btn${viewOnce ? ' on' : ''}`}
              title="View once"
              onClick={() => setViewOnce((v) => !v)}
            >
              {onceBadge}
            </button>
            <input
              className="picker-caption"
              value={galleryCaption}
              onChange={(e) => setGalleryCaption(e.target.value)}
              placeholder="Add a caption…"
            />
            <button
              type="button"
              className="send-btn"
              onClick={sendGallery}
              disabled={sending || !gallerySel.some(Boolean)}
              title="Send"
            >
              <IconSend size={20} />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
