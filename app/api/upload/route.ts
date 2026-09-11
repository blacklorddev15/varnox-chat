import { requireUser } from '@/lib/auth';
import { bad, handle, ok } from '@/lib/api';
import { putBinary, rand } from '@/lib/blob';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return bad('No file was uploaded');
    if (file.size === 0) return bad('The file is empty');
    if (file.size > MAX_BYTES) return bad('Images must be smaller than 6 MB');
    if (!ALLOWED.includes(file.type)) return bad('Only JPG, PNG, WEBP or GIF images are supported');

    const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await putBinary(`vx/media/${rand(10)}.${ext}`, buffer, file.type);

    return ok({ url, size: file.size, type: file.type, width: 0, height: 0 }, 201);
  });
}
