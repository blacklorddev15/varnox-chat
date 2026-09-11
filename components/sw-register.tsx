'use client';

import { useEffect } from 'react';

/** Registers the offline-shell service worker so Varnox is installable. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}
