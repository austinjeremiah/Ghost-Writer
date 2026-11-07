import type { Metadata, Viewport } from 'next';

// The template's Kido cream/royal-blue tokens and fonts, plus the app's own rules.
import '@/styles/app.css';

import { ClientRoot } from './client-root';

const description =
  'Liquidation cover for Sui borrowers, priced by an AI underwriter whose memory lives on Walrus Memory.';

export const metadata: Metadata = {
  title: 'Ghostwriter',
  description,
  icons: { icon: '/favicon.svg' },
  openGraph: { title: 'Ghostwriter', description },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Browser extensions (e.g. Grammarly) add attributes to <html>/<body> before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ClientRoot>{children}</ClientRoot>
      </body>
    </html>
  );
}
