import type { Metadata } from 'next';
import './globals.css';
import Nav from './components/Nav';
import navStyles from './components/nav.module.css';

export const metadata: Metadata = {
  title: 'SKNLP Info Hub',
  description: 'Official, sourced record of SKNLP accomplishments and public statements — SKNLP Info Hub.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Semi+Condensed:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body">
        <div className="bezier-wash" aria-hidden="true">
          <svg viewBox="0 0 900 900" width="900" height="900" style={{ position: 'absolute', top: 0, right: 0, opacity: 0.5 }}>
            <defs>
              <filter id="soft-blur" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="60" />
              </filter>
              <linearGradient id="wash1" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#F7C9CE" />
                <stop offset="100%" stopColor="#F4B400" />
              </linearGradient>
            </defs>
            <path
              filter="url(#soft-blur)"
              fill="url(#wash1)"
              fillOpacity={0.35}
              d="M780 60C900 140 940 320 860 460C780 600 600 640 460 600C320 560 220 440 240 300C260 160 400 40 540 40C620 40 700 20 780 60Z"
            />
            <path
              filter="url(#soft-blur)"
              fill="#C8102E"
              fillOpacity={0.14}
              d="M900 300C960 420 900 560 760 600C620 640 480 560 460 440C440 320 540 200 680 180C780 166 860 220 900 300Z"
            />
          </svg>
        </div>
        <div style={{ position: 'relative', zIndex: 1 }} className={navStyles.shell}>
          <Nav />
          <div className={navStyles.content}>{children}</div>
        </div>
      </body>
    </html>
  );
}
