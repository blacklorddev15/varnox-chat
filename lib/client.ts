'use client';

import {
  OfflineError,
  cacheGet,
  cachePut,
  isCacheableRead,
  markNetworkDown,
  markNetworkUp,
} from './offline';

/**
 * Browser-side fetch helper for the Varnox API.
 *
 * Reads are remembered so the app still has something to show without a connection. Writes are
 * not queued and not retried — a message that was written while offline and sent minutes later
 * would arrive in an order nobody could see coming, so sending is simply refused and says so.
 * See lib/offline.ts for why the app now keeps a copy of anything at all.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  /**
   * Only GETs, and only the ones worth keeping. A write is a change, and a stale copy of one is
   * worse than none; a cursor or a live session is not a thing that can be remembered at all.
   * See isCacheableRead, which is where the second half of that is spelled out — the short
   * version is that the call's signalling poll must not go near this.
   */
  const readable = method === 'GET' && isCacheableRead(path);

  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      headers:
        init.body instanceof FormData
          ? init.headers
          : { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    // The request never left the device. This is the real evidence of being offline — richer
    // than navigator.onLine, which is true on a wifi that goes nowhere.
    markNetworkDown();
    if (readable) {
      const cached = cacheGet<T>(path);
      if (cached.hit) return cached.value;
    }
    throw new OfflineError();
  }

  markNetworkUp();

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  /**
   * A server-side failure is treated like a network failure for reads.
   *
   * This is what makes the app work offline in the bundled Android build, where the page is
   * served from a loopback address and an unreachable backend comes back as a 502 from the
   * local proxy rather than as a thrown fetch. Without this branch, that build would show a
   * blank screen offline while the browser build showed the cached chat — the same situation
   * behaving two ways depending on which shell is asking.
   *
   * Only 5xx. A 401, 403 or 404 is the server giving a real answer about the request, and
   * answering that with an old copy would be inventing a truth the server has just denied.
   */
  if (!res.ok && readable && res.status >= 500) {
    const cached = cacheGet<T>(path);
    if (cached.hit) {
      // Marked knowing, because answering from the cache without saying so is the one outcome
      // worse than showing nothing: the app would present an old chat as the current one and
      // offer no reason to think otherwise. Every successful request clears it again, so this
      // corrects itself the moment the backend answers.
      markNetworkDown();
      return cached.value;
    }
  }

  if (!res.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(message);
  }

  if (readable) cachePut(path, payload);
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
