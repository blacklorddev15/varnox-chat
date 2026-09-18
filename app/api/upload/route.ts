import { requireUser } from '@/lib/auth';
import { bad, handle, ok } from '@/lib/api';
import { extensionFor, saveMedia } from '@/lib/media';

export const dynamic = 'force-dynamic';

// Vercel functions cap request bodies at ~4.5 MB, so stay comfortably under it.
const MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-m4a'];
const VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/x-msvideo',
];

/** Magic-byte signatures, so a declared type cannot be trusted on its own. */
function sniff(bytes: Uint8Array): string | null {
  const starts = (sig: number[], offset = 0) =>
    sig.every((byte, i) => bytes[offset + i] === byte);
  if (starts([0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (starts([0x1a, 0x45, 0xdf, 0xa3])) return 'audio/webm';
  if (starts([0x4f, 0x67, 0x67, 0x53])) return 'audio/ogg';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x41, 0x56, 0x45], 8)) return 'audio/wav';
  if (starts([0x49, 0x44, 0x33]) || starts([0xff, 0xfb])) return 'audio/mpeg';
  if (starts([0x66, 0x74, 0x79, 0x70], 4)) return 'audio/mp4';
  return null;
}

/**
 * Whether the bytes are in a container that can hold video.
 *
 * Deliberately answers only the container question, because the containers are shared: an mp4
 * and an m4a are both `....ftyp`, a webm and an opus recording are both EBML, and the audio
 * sniff above therefore reports video files as audio. Nothing in the first sixteen bytes
 * settles which of the two a file is, so the caller pairs this with the declared type — the
 * browser picked the container and is the only party that knows what is inside it.
 */
export function looksLikeVideoContainer(bytes: Uint8Array): boolean {
  const starts = (sig: number[], offset = 0) =>
    sig.every((byte, i) => bytes[offset + i] === byte);
  if (starts([0x66, 0x74, 0x79, 0x70], 4)) return true; // ....ftyp — mp4, mov
  if (starts([0x1a, 0x45, 0xdf, 0xa3])) return true; // EBML — webm, mkv
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x41, 0x56, 0x49, 0x20], 8)) return true; // RIFF AVI
  return false;
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return bad('No file was uploaded');
    if (file.size === 0) return bad('The file is empty');

    const kind = String(form.get('kind') ?? 'auto');
    if (file.size > MAX_BYTES) {
      // Video gets its own wording because this ceiling is the single thing standing between
      // this app and real video, and "under 4 MB" alone reads as an arbitrary app limit rather
      // than a platform one. It is Vercel's: a function request body may not exceed 4.5 MB, so
      // a phone video — routinely 20 to 200 MB — cannot come through here at any setting.
      return bad(
        kind === 'video'
          ? 'Videos must be under 4 MB, which is only a few seconds, because a Vercel function cannot accept a larger request. Sending full-length video needs storage outside the app.'
          : 'Files must be smaller than 4 MB'
      );
    }
    // View-once only means anything for something you look at or listen to. A one-shot PDF
    // is not a thing anyone asks for, and allowing it would just be a footgun.
    const once = String(form.get('once') ?? '') === '1';

    // A recording arrives as "audio/webm;codecs=opus" from Chrome and Android, or
    // "audio/mp4;codecs=…" from Safari, and sometimes with no type at all. Comparing that
    // whole string against an allowlist therefore rejects perfectly good voice notes, which
    // is exactly what it used to do. Only the media type before the parameters is compared,
    // and the bytes are what decide what the file actually is.
    const declared = (file.type || '').split(';')[0].trim().toLowerCase();
    const declaredImage = IMAGE_TYPES.includes(declared);
    const declaredAudio = AUDIO_TYPES.includes(declared);
    const declaredVideo = VIDEO_TYPES.includes(declared);

    const buffer = Buffer.from(await file.arrayBuffer());
    const head = new Uint8Array(buffer.subarray(0, 16));
    const real = sniff(head);
    const realImage = Boolean(real && IMAGE_TYPES.includes(real));
    const realAudio = Boolean(real && AUDIO_TYPES.includes(real));
    const realVideoContainer = looksLikeVideoContainer(head);

    let category: 'images' | 'voice' | 'video' | 'docs' = 'docs';
    // Stored and echoed back as the sniffed type, so the message records what the file is
    // rather than what the browser claimed.
    let mime = declared || 'application/octet-stream';

    if (kind === 'video' || (kind === 'auto' && declaredVideo)) {
      // Checked first because the audio sniff claims these containers: `....ftyp` is reported
      // as audio/mp4 above, so a video reaching the audio branch would be accepted as a voice
      // note and stored with the wrong type.
      if (!realVideoContainer) {
        return bad(
          declaredVideo
            ? 'That file is not a real video'
            : 'Only MP4, WEBM, MOV or MKV videos are supported'
        );
      }
      category = 'video';
      // Unlike images and audio, the bytes cannot be trusted to name the type here: the same
      // container carries both video and audio, so the declared type is taken at its word when
      // it is one we know, and an unrecognised-but-valid container falls back to video/mp4.
      mime = declaredVideo ? declared : 'video/mp4';
    } else if (kind === 'image' || (kind === 'auto' && (declaredImage || realImage))) {
      if (!realImage) {
        return bad(
          declaredImage
            ? 'That file is not a real image'
            : 'Only JPG, PNG, WEBP or GIF images are supported'
        );
      }
      category = 'images';
      mime = String(real);
    } else if (kind === 'audio' || (kind === 'auto' && (declaredAudio || realAudio))) {
      if (!realAudio) {
        return bad(
          declaredAudio ? 'That file is not a real audio recording' : 'Unsupported audio format'
        );
      }
      category = 'voice';
      mime = String(real);
    }

    // Stored in Postgres and served back through /api/media/<id>. The extension is kept
    // on the URL so a direct link or a download saves with a sensible name.
    // Video is excluded as well as documents: a view-once video has no way to be watched and
    // then un-watched here, and the serving route only knows how to spend a photo or a voice
    // note. The composer never offers the flag for video, so this only backstops a hand-made
    // request.
    if (once && (category === 'docs' || category === 'video')) {
      return bad('Only photos and voice notes can be sent as view once');
    }

    const stored = await saveMedia(buffer, mime, once);
    const url = `${stored.url}.${extensionFor(mime)}`;

    return ok(
      {
        url,
        size: file.size,
        mime,
        name: file.name || 'file',
        category,
        once,
      },
      201
    );
  });
}
