'use client';

/** Browser-side fetch helper for the Varnox API. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
    headers:
      init.body instanceof FormData
        ? init.headers
        : { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
}

export function patch<T>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) });
}

export function del<T>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, { method: 'DELETE', body: body === undefined ? undefined : JSON.stringify(body) });
}

/** Downscale an image in the browser so photos stay small and fast to send. */
export async function compressImage(file: File, maxSide = 1600, quality = 0.82) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that image'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not decode that image'));
    el.src = dataUrl;
  });

  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { blob: file, width: img.width, height: img.height };
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
  );
  if (!blob) return { blob: file, width: w, height: h };
  return { blob, width: w, height: h };
}

export type UploadResult = {
  url: string;
  size: number;
  mime: string;
  name: string;
  width: number;
  height: number;
  once?: boolean;
};

/**
 * Upload a photo, voice note, video or document. Photos are downscaled first; video is not
 * touched, because re-encoding it in the browser would cost more time than the upload saves.
 */
export async function uploadMedia(
  file: File,
  kind: 'image' | 'audio' | 'video' | 'auto',
  once = false
): Promise<UploadResult> {
  let blob: Blob = file;
  let width = 0;
  let height = 0;

  if (kind === 'image' && file.type.startsWith('image/')) {
    const squeezed = await compressImage(file);
    blob = squeezed.blob;
    width = squeezed.width;
    height = squeezed.height;
  }

  const form = new FormData();
  form.append('kind', kind);
  if (once) form.append('once', '1');
  form.append('file', new File([blob], file.name || 'upload', { type: blob.type || file.type }));

  const res = await api<{ url: string; size: number; mime: string; name: string }>('/api/upload', {
    method: 'POST',
    body: form,
  });
  return { ...res, width, height };
}

export function uploadImage(file: File): Promise<UploadResult> {
  return uploadMedia(file, 'image');
}
