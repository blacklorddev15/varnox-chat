import { requireUser } from '@/lib/auth';
import { bad, handle, ok } from '@/lib/api';
import { putBinary, rand } from '@/lib/blob';

export const dynamic = 'force-dynamic';

// Vercel functions cap request bodies at ~4.5 MB, so stay comfortably under it.
const MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-m4a'];

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

    let category: 'images' | 'voice' | 'docs' = 'docs';
    if (kind === 'image' || (kind === 'auto' && isImage)) {
      if (!isImage) return bad('Only JPG, PNG, WEBP or GIF images are supported');
      category = 'images';
    } else if (kind === 'audio' || (kind === 'auto' && isAudio)) {
      if (!isAudio) return bad('Unsupported audio format');
      category = 'voice';
    }

    const ext = (type.split('/')[1] || 'bin').split(';')[0].replace('jpeg', 'jpg').slice(0, 8);
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await putBinary(`vx/media/${category}/${rand(12)}.${ext}`, buffer, type);

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
