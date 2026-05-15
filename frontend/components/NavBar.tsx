'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, Gauge, Microscope, ScanLine, ScrollText } from 'lucide-react';

import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Box from '@mui/material/Box';
import MuiButton from '@mui/material/Button';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { AiHealthBadge } from '@/components/ai-health-badge';

const navItems = [
  { href: '/', label: 'Dashboard', icon: Gauge },
  { href: '/workspace', label: 'Workspace', icon: ScanLine },
  { href: '/report', label: 'Báo cáo', icon: ScrollText },
  { href: '/analytics', label: 'Thống kê', icon: BarChart3 },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        backgroundColor: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid #E2EAE8',
        zIndex: 50,
      }}
    >
      <Container maxWidth="lg">
        <Toolbar disableGutters sx={{ gap: 2, justifyContent: 'space-between', py: 0.5 }}>
          {/* Logo */}
          <Box
            component={Link}
            href="/"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 38,
                height: 38,
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #006064 0%, #00838F 100%)',
                color: '#fff',
                flexShrink: 0,
                boxShadow: '0 4px 12px rgba(0,96,100,0.3)',
              }}
            >
              <Microscope size={20} />
            </Box>
            <Box sx={{ lineHeight: 1 }}>
              <Typography
                variant="caption"
                sx={{ fontWeight: 700, color: 'primary.main', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block' }}
              >
                AI Endoscopy Suite
              </Typography>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.primary', lineHeight: 1.2 }}>
                Smart Endoscopy
              </Typography>
            </Box>
          </Box>

          {/* Nav Items + AI health pill (Phase C5) */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, overflowX: 'auto' }}>
            <Box sx={{ mr: 1 }}><AiHealthBadge /></Box>
            {navItems.map(({ href, label, icon: Icon }) => {
              const isActive = pathname === href;
              return (
                <MuiButton
                  key={href}
                  component={Link}
                  href={href}
                  size="small"
                  sx={{
                    textTransform: 'none',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.75,
                    borderRadius: '8px',
                    px: 1.75,
                    py: 0.875,
                    minWidth: 0,
                    transition: 'all 0.2s ease',
                    color: isActive ? 'primary.main' : 'text.secondary',
                    backgroundColor: isActive ? 'rgba(0,96,100,0.08)' : 'transparent',
                    position: 'relative',
                    '&::after': isActive
                      ? {
                          content: '""',
                          position: 'absolute',
                          bottom: -1,
                          left: '50%',
                          transform: 'translateX(-50%)',
                          width: '60%',
                          height: 2,
                          borderRadius: '2px 2px 0 0',
                          backgroundColor: 'primary.main',
                        }
                      : {},
                    '&:hover': {
                      backgroundColor: 'rgba(0,96,100,0.06)',
                      color: 'primary.dark',
                    },
                  }}
                  startIcon={<Icon size={15} />}
                >
                  {label}
                </MuiButton>
              );
            })}
          </Box>
        </Toolbar>
      </Container>
    </AppBar>
  );
}
