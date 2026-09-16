import { requireUser } from '@/lib/auth';
import { bad, handle, ok } from '@/lib/api';
import { extensionFor, saveMedia } from '@/lib/media';

export const dynamic = 'force-dynamic';

// Vercel functions cap request bodies at ~4.5 MB, so stay comfortably under it.
const MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-m4a'];

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

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return bad('No file was uploaded');
    if (file.size === 0) return bad('The file is empty');
    if (file.size > MAX_BYTES) return bad('Files must be smaller than 4 MB');

    const kind = String(form.get('kind') ?? 'auto');
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

    const buffer = Buffer.from(await file.arrayBuffer());
    const real = sniff(new Uint8Array(buffer.subarray(0, 16)));
    const realImage = Boolean(real && IMAGE_TYPES.includes(real));
    const realAudio = Boolean(real && AUDIO_TYPES.includes(real));

    let category: 'images' | 'voice' | 'docs' = 'docs';
    // Stored and echoed back as the sniffed type, so the message records what the file is
    // rather than what the browser claimed.
    let mime = declared || 'application/octet-stream';

    if (kind === 'image' || (kind === 'auto' && (declaredImage || realImage))) {
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
    if (once && category === 'docs') {
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
