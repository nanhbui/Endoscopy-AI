'use client';

/**
 * ai-health-badge.tsx — Phase C5 visual indicator.
 *
 * Polls /health/ollama every 30s and renders a compact pill:
 *   • green  — AI sẵn sàng (latency under threshold)
 *   • yellow — AI chậm (>3s response on health probe)
 *   • red    — AI offline / lỗi (with tooltip showing error code)
 *
 * Self-contained: own state, own polling, no context dependency. Drop into
 * the workspace header. Click to force-refresh.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Cpu, CircleAlert, CircleCheck, RefreshCw } from 'lucide-react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { API_BASE } from '@/lib/ws-client';

interface HealthResp {
  ok: boolean;
  model?: string;
  backend?: string;
  latency_ms?: number;
  code?: string;
  error?: string;
}

const POLL_INTERVAL_MS = 30_000;
const SLOW_LATENCY_MS  = 3000;

export function AiHealthBadge() {
  const [health, setHealth] = useState<HealthResp | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const probe = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/health/ollama`);
      const data = await res.json() as HealthResp;
      setHealth(data);
    } catch (err) {
      setHealth({ ok: false, code: 'NETWORK', error: String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    probe();
    timerRef.current = setInterval(probe, POLL_INTERVAL_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [probe]);

  // Decide visual state: pending = grey, ok-fast = green, ok-slow = yellow,
  // not-ok = red. Picked colors to match the existing severity palette.
  const state: 'pending' | 'ok' | 'slow' | 'down' =
    !health ? 'pending'
    : !health.ok ? 'down'
    : (health.latency_ms ?? 0) > SLOW_LATENCY_MS ? 'slow'
    : 'ok';

  const cfg = {
    pending: { color: '#9AA5B1', bg: 'rgba(154,165,177,0.1)', label: 'AI đang kiểm tra…', icon: <Cpu size={12} /> },
    ok:      { color: '#2E7D32', bg: 'rgba(46,125,50,0.10)',  label: 'AI sẵn sàng',        icon: <CircleCheck size={12} /> },
    slow:    { color: '#ED6C02', bg: 'rgba(237,108,2,0.10)',  label: 'AI chậm',            icon: <Cpu size={12} /> },
    down:    { color: '#D32F2F', bg: 'rgba(211,47,47,0.10)',  label: 'AI offline',         icon: <CircleAlert size={12} /> },
  }[state];

  const tooltip = !health ? 'Đang kiểm tra Ollama…'
    : health.ok
      ? `${health.model ?? 'AI'} · ${health.backend} · ${health.latency_ms}ms · Nhấn để refresh`
      : `${health.code ?? 'ERROR'}: ${health.error ?? 'không kết nối'} · Nhấn để thử lại`;

  return (
    <Tooltip title={tooltip} arrow>
      <Box
        onClick={loading ? undefined : probe}
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.5,
          px: 1, py: 0.4, borderRadius: '6px',
          backgroundColor: cfg.bg, color: cfg.color,
          border: `1px solid ${cfg.color}30`,
          cursor: loading ? 'wait' : 'pointer',
          userSelect: 'none',
          '&:hover': { backgroundColor: cfg.bg.replace('0.10', '0.18') },
        }}
      >
        {loading ? (
          <RefreshCw size={12} className="rotating" />
        ) : (
          cfg.icon
        )}
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, lineHeight: 1 }}>
          {cfg.label}
        </Typography>
        <style jsx>{`
          .rotating { animation: spin 0.8s linear infinite; }
          @keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        `}</style>
      </Box>
    </Tooltip>
  );
}
