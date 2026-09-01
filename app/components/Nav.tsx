'use client';

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
  }
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className={styles.sidebar}>
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
            className={`${styles.navItem} ${isActive(pathname, link.href) ? styles.active : ''}`}
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
            className={`${styles.navItem} ${styles.navItemInternal} ${isActive(pathname, link.href) ? styles.active : ''}`}
          >
            {link.icon}
            {link.label}
            <span className={styles.internalBadge}>Admin</span>
          </Link>
        ))}
      </div>

      <div className={styles.sidebarFooter}>Proof of concept &middot; not for public release</div>
    </nav>
  );
}
