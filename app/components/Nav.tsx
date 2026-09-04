'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './nav.module.css';

interface NavLink {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const BROWSE_LINKS: NavLink[] = [
  {
    href: '/',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    )
  },
  {
    href: '/ask',
    label: 'Ask the Record',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    )
  },
  {
    href: '/opposition-watch',
    label: 'Opposition Watch',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M8 3v18M16 3v18M3 8h5M16 8h5M3 16h5M16 16h5" />
      </svg>
    )
  },
  {
    href: '/topics',
    label: 'Both Sides',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
    )
  },
  {
    href: '/timeline',
    label: 'Timeline',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    )
  },
  {
    href: '/suggest',
    label: 'Suggest a Priority',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 20l9-9-9-9M3 12h18" transform="rotate(-45 12 12)" />
        <path d="M12 3v3M12 18v3" />
      </svg>
    )
  }
];

const INTERNAL_LINKS: NavLink[] = [
  {
    href: '/review-queue',
    label: 'Review Queue',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
      </svg>
    )
  },
  {
    href: '/source-manager',
    label: 'Source Manager',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 7a4 4 0 014-4h10a4 4 0 014 4v10a4 4 0 01-4 4H7a4 4 0 01-4-4V7z" />
        <path d="M3 11h18" />
      </svg>
    )
  },
  {
    href: '/source-manager/suggestions',
    label: 'Trending Suggestions',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 17l6-6 4 4 8-8M15 5h6v6" />
      </svg>
    )
  },
  {
    href: '/source-manager/opposition-pulse',
    label: 'Opposition Pulse',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 12h4l3 8 4-16 3 8h4" />
      </svg>
    )
  },
  {
    href: '/chat-feedback',
    label: 'Chat Feedback',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        <path d="M8 10h8M8 13h5" />
      </svg>
    )
  }
];

function matches(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

// Source Manager's own nav links are prefixes of its sub-pages'
// (/source-manager vs /source-manager/suggestions and
// /source-manager/opposition-pulse), so a naive per-link prefix check
// highlighted BOTH "Source Manager" and the sub-page you were actually
// on -- reported directly: buttons in the Internal section stayed
// highlighted after clicking something else. Fixed by picking exactly
// one active link sitewide: whichever matching href is the longest
// (most specific), never more than one at a time.
function getActiveHref(pathname: string, links: NavLink[]): string | null {
  let best: string | null = null;
  for (const link of links) {
    if (matches(pathname, link.href) && (!best || link.href.length > best.length)) {
      best = link.href;
    }
  }
  return best;
}

export default function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const activeHref = getActiveHref(pathname, [...BROWSE_LINKS, ...INTERNAL_LINKS]);

  // Close the drawer on every route change -- otherwise it stays open
  // after tapping a link and the new page renders underneath it.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock background scroll while the mobile drawer is open -- standard
  // off-canvas-nav expectation, and without it the page behind the
  // drawer scrolls along with a swipe meant for the menu.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <div className={styles.mobileBar}>
        <Link href="/" className={styles.mobileWordmark}>
          <div className={styles.pin}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className={styles.wordmarkTitle}>SKNLP</div>
        </Link>
        <button
          type="button"
          className={styles.menuButton}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
          </svg>
        </button>
      </div>

      {open && <div className={styles.backdrop} onClick={() => setOpen(false)} aria-hidden="true" />}

      <nav className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''}`}>
        <Link href="/" className={styles.wordmark}>
        <div className={styles.pin}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <div className={styles.wordmarkTitle}>SKNLP</div>
          <div className={styles.wordmarkSubtitle}>Info Hub</div>
        </div>
      </Link>

      <div className={styles.navGroup}>
        <div className={styles.navLabel}>Browse</div>
        {BROWSE_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`${styles.navItem} ${link.href === activeHref ? styles.active : ''}`}
          >
            {link.icon}
            {link.label}
          </Link>
        ))}
      </div>

      <div className={styles.navGroup}>
        <div className={styles.navLabel}>Internal (proof of concept)</div>
        {INTERNAL_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`${styles.navItem} ${styles.navItemInternal} ${link.href === activeHref ? styles.active : ''}`}
          >
            {link.icon}
            {link.label}
            <span className={styles.internalBadge}>Admin</span>
          </Link>
        ))}
      </div>

      <div className={styles.sidebarFooter}>Proof of concept &middot; not for public release</div>
      </nav>
    </>
  );
}
