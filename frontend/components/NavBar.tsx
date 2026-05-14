'use client';

/**
 * NavBar — ported from new-theme/endoscopy/shared/app.jsx.
 *
 * Plain <header> instead of MUI AppBar so the design matches new-theme's
 * inline-style approach. Tokens come from tokens.css (var(--token)).
 * Sticky, 64px tall, translucent white with backdrop-blur.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Microscope, Gauge, ScanLine, ScrollText, Activity, Settings, BookOpen,
} from 'lucide-react';

const navItems = [
  { href: '/',          label: 'Dashboard', icon: Gauge },
  { href: '/workspace', label: 'Workspace', icon: ScanLine },
  { href: '/report',    label: 'Báo cáo',   icon: ScrollText },
  { href: '/train',     label: 'Train',     icon: Activity },
  { href: '/docs',      label: 'Tài liệu',  icon: BookOpen },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <header
      style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(255,255,255,0.92)',
        backdropFilter: 'saturate(180%) blur(10px)',
        WebkitBackdropFilter: 'saturate(180%) blur(10px)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <div
        style={{
          maxWidth: 1440,
          margin: '0 auto',
          height: 64,
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 24,
        }}
      >
        {/* Brand — gradient mark + 2-line text */}
        <Link
          href="/"
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            marginRight: 8, textDecoration: 'none', color: 'inherit',
          }}
        >
          <span
            style={{
              width: 38, height: 38, borderRadius: 10,
              background: 'var(--hero-gradient)',
              color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,96,100,0.30)',
              flexShrink: 0,
            }}
            aria-label="AI Endoscopy Suite logo"
          >
            {/* Microscope icon — original brand mark, more recognizable than
                new-theme's scope-aperture SVG. Inset on the hero-gradient
                tile from new-theme so the chrome still feels updated. */}
            <Microscope size={22} strokeWidth={2.2} />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em', color: 'var(--neutral-800)' }}>
              AI Endoscopy Suite
            </span>
            <span style={{ fontSize: 11, color: 'var(--neutral-500)', letterSpacing: '0.04em' }}>
              HỆ THỐNG PHÂN TÍCH NỘI SOI
            </span>
          </span>
        </Link>

        {/* Nav links */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 12px', borderRadius: 8,
                  fontSize: 13, fontWeight: 550,
                  textDecoration: 'none',
                  color: isActive ? 'var(--teal-700)' : 'var(--neutral-600)',
                  background: isActive ? 'var(--teal-50)' : 'transparent',
                  transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast)',
                }}
              >
                <Icon size={16} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right cluster — settings + avatar. Backend status pill will land
            here once PR #25 (AiHealthBadge) merges. */}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <button
            aria-label="Cài đặt"
            type="button"
            style={{
              width: 36, height: 36, borderRadius: 8,
              background: 'transparent', border: '1px solid var(--border-subtle)',
              color: 'var(--neutral-600)', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background var(--dur-fast)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--neutral-100)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <Settings size={16} />
          </button>
          <div
            aria-label="Bác sĩ"
            title="Bác sĩ"
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'var(--teal-600)', color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, letterSpacing: '0.05em',
            }}
          >
            BS
          </div>
        </div>
      </div>
    </header>
  );
}
