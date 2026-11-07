import type { Metadata, Viewport } from 'next';

// Tailwind first: its utilities sit in a cascade layer, so the unlayered
// rules in globals.css below always take precedence.
import '@/styles/tailwind.css';
import '@/styles/globals.css';
import '@/components/Video/video.css';

import AppGrid from '@/components/AppGrid';
import AppLoader from '@/components/AppLoader';
import JoinBetaForm from '@/components/JoinBetaForm';
import Loader from '@/components/Loader';
import ToastContainer from '@/components/ToastContainer';
import { UiProvider } from '@/store/ui';

/** Carried over verbatim from the template's <head>. */
export const metadata: Metadata = {
  title: 'Ghost Writer: the fastest and easiest way to connect with your customer',
  description:
    'Ghost Writer is an easy in use data sender from a website’s contact form to different messengers and emails: What’s App, Discord, Telegram and etc.',
  // `metadataBase` silences Next's warning when resolving the OG image URL.
  metadataBase: new URL('http://localhost:3000'),
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title: 'Ghost Writer: the fastest and easiest way to connect with your customer',
    description:
      'Ghost Writer is an easy in use data sender from a website’s contact form to different messengers and emails: What’s App, Discord, Telegram and etc.',
    images: ['/twitter.png'],
  },
  twitter: {
    title: 'Ghost Writer: the fastest and easiest way to connect with your customer',
    description:
      'Ghost Writer is an easy in use data sender from a website’s contact form to different messengers and emails: What’s App, Discord, Telegram and etc.',
    images: ['/twitter.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* The stylesheet declares these four faces; preload them so the
            oversized headings do not reflow. See MISSING-ASSETS.md. */}
        {[
          'Aeonik-Regular',
          'NeueHaasDisplay-Medium',
          'NeueHaasDisplay-Roman',
          'RecifeDisplayWeb-BookItalic',
        ].map((font) => (
          <link
            key={font}
            rel="preload"
            as="font"
            type="font/woff2"
            href={`/fonts/${font}.woff2`}
            crossOrigin="anonymous"
          />
        ))}
      </head>
      <body>
        <UiProvider>
          <div id="__nuxt">
            <div id="app">
              <AppGrid />
              <Loader />
              <AppLoader />
              {children}
              <JoinBetaForm />
              <ToastContainer />
            </div>
          </div>
        </UiProvider>
      </body>
    </html>
  );
}
