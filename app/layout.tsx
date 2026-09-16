import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ServiceWorkerRegistrar } from '@/components/sw-register';

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
    { media: '(prefers-color-scheme: dark)', color: '#0a0805' },
    { media: '(prefers-color-scheme: light)', color: '#fffdf8' },
  ],
};

const themeBootstrap = `try{var t=localStorage.getItem('varnox-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
