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
    const type = file.type || 'application/octet-stream';
    const isImage = IMAGE_TYPES.includes(type);
    const isAudio = AUDIO_TYPES.includes(type);
    const buffer = Buffer.from(await file.arrayBuffer());

    let category: 'images' | 'voice' | 'docs' = 'docs';
    if (kind === 'image' || (kind === 'auto' && isImage)) {
      if (!isImage) return bad('Only JPG, PNG, WEBP or GIF images are supported');
      // The bytes must actually be an image; the declared type is not trusted.
      const real = sniff(new Uint8Array(buffer.subarray(0, 16)));
      if (!real || !IMAGE_TYPES.includes(real)) {
        return bad('That file is not a real image');
      }
      category = 'images';
    } else if (kind === 'audio' || (kind === 'auto' && isAudio)) {
      if (!isAudio) return bad('Unsupported audio format');
      const real = sniff(new Uint8Array(buffer.subarray(0, 16)));
      if (!real || !AUDIO_TYPES.includes(real)) {
        return bad('That file is not a real audio recording');
      }
      category = 'voice';
    }

    // Stored in Postgres and served back through /api/media/<id>. The extension is kept
    // on the URL so a direct link or a download saves with a sensible name.
    const stored = await saveMedia(buffer, type);
    const url = `${stored.url}.${extensionFor(type)}`;

    return ok(
      {
        url,
        size: file.size,
        mime: type,
        name: file.name || 'file',
        category,
      },
      201
    );
  });
}
