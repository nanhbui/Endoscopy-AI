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
  Microscope, Gauge, ScanLine, ScrollText, BarChart3, BookOpen, Settings,
} from 'lucide-react';
import { AiHealthBadge } from '@/components/ai-health-badge';

const navItems = [
  { href: '/',          label: 'Dashboard', icon: Gauge },
  { href: '/workspace', label: 'Workspace', icon: ScanLine },
  { href: '/report',    label: 'Báo cáo',   icon: ScrollText },
  // Replaces the empty /train placeholder — /analytics wires SQLite aggregates
  // (KPIs + charts + false-positive review) into a single dashboard page.
  { href: '/analytics', label: 'Thống kê',  icon: BarChart3 },
  // Static intro/usage guide for doctors + thesis reviewers. Pure content
  // page (no backend), sits right after Thống kê.
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
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
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
          {/* Brand text hides on very narrow screens (<420px) so the logo
              + nav links still fit horizontally without overflow. */}
          <span
            className="brand-text"
            style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}
          >
            <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em', color: 'var(--neutral-800)', whiteSpace: 'nowrap' }}>
              AI Endoscopy Suite
            </span>
            <span style={{ fontSize: 11, color: 'var(--neutral-500)', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
              HỆ THỐNG PHÂN TÍCH NỘI SOI
            </span>
          </span>
        </Link>

        {/* Nav links — horizontal scroll when the viewport can't fit all
            items rather than wrapping into a 2nd line that breaks the header.
            justifyContent: center balances the bar visually so links sit in
            the gap between the brand (left) and the action cluster (right)
            instead of crowding the left side. */}
        <nav
          className="nav-links"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 4,
            flex: 1, minWidth: 0,
            overflowX: 'auto', overflowY: 'hidden',
            scrollbarWidth: 'none',
          }}
        >
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className="nav-link"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 12px', borderRadius: 8,
                  fontSize: 13, fontWeight: 550,
                  textDecoration: 'none', flexShrink: 0,
                  color: isActive ? 'var(--teal-700)' : 'var(--neutral-600)',
                  background: isActive ? 'var(--teal-50)' : 'transparent',
                  transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast)',
                }}
              >
                <Icon size={16} />
                <span className="nav-link-label">{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right cluster — settings + avatar. Collapses on narrow screens so
            the nav links keep priority. */}
        <div
          className="nav-right"
          style={{
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          }}
        >
          {/* AI health pill (Phase C5 / PR #25) — polls /health/ollama every
              30s; click to refresh. Lives in the right cluster so doctors
              spot AI status without scrolling. */}
          <AiHealthBadge />
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

      {/* Responsive rules — keep the chrome readable on phones without a
          dedicated mobile component. Three breakpoints, smallest first:
          - <960px: drop the brand subtitle and the Settings icon
          - <720px: drop the nav link labels (icons only), shrink the brand
          - <520px: drop the brand wordmark + avatar; only icons remain
          Also hides the horizontal scrollbar on the nav strip. */}
      <style jsx global>{`
        .nav-links { -ms-overflow-style: none; }
        .nav-links::-webkit-scrollbar { display: none; }

        @media (max-width: 960px) {
          .brand-text > span:last-child { display: none !important; }
        }
        @media (max-width: 720px) {
          .nav-link-label { display: none !important; }
          .nav-link { padding: 8px 10px !important; }
          .brand-text > span:first-child { font-size: 13px !important; }
        }
        @media (max-width: 520px) {
          .brand-text { display: none !important; }
          .nav-right > [aria-label='Cài đặt'] { display: none !important; }
        }
      `}</style>
    </header>
  );
}
