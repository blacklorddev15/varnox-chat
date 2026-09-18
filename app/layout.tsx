import type { Metadata, Viewport } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import './globals.css';
import { ServiceWorkerRegistrar } from '@/components/sw-register';
import { OfflineBanner } from '@/components/offline-banner';

/**
 * The reference's two families. Self-hosted through next/font rather than linked from
 * Google: the same fonts, but fetched at build time and served from our own origin, so
 * there is no third-party request on load and no flash of the fallback.
 *
 * Playfair carries the italic headings — --font-display is set in an italic serif
 * throughout the stylesheet — so it needs its italic cut. Inter carries everything else.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  // The italic cut is loaded because two small annotations — "edited" and "forwarded" —
  // are set in it. Without it the browser would synthesise a slant from the upright face.
  style: ['normal', 'italic'],
  variable: '--font-inter',
});
const playfair = Playfair_Display({
  subsets: ['latin'],
  display: 'swap',
  style: ['normal', 'italic'],
  variable: '--font-playfair',
});

export const metadata: Metadata = {
  title: 'Varnox',
  description:
    'Varnox is a fast, private messenger: one-to-one chats and group conversations with photos, read receipts and replies.',
  applicationName: 'Varnox',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Varnox' },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icon-192.png', sizes: '192x192' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: [
    // Matches --app-bg in each theme, so the status bar blends into the app surface
    // instead of drawing a band of a colour the app no longer uses.
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
    { media: '(prefers-color-scheme: light)', color: '#fffdf8' },
  ],
};

const themeBootstrap = `try{var t=localStorage.getItem('varnox-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${inter.variable} ${playfair.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        {children}
        <OfflineBanner />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
