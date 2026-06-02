'use client';

/**
 * confirmed-captures-panel.tsx — Phase 02
 *
 * Grid of silent captures emitted by the worker when a track is registered
 * via "Xác nhận luôn". Click a tile to seek the <video> element to that
 * capture's timestamp. Hidden when there are no captures.
 *
 * Captures are session-only (frame_b64 stripped before localStorage write).
 */

import { useMemo, type RefObject } from 'react';
import { Clock, X } from 'lucide-react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import type { CapturedDetection } from '@/context/AnalysisContext';

interface Props {
  captures: CapturedDetection[];
  /** workspace video element — seek target on tile click. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Optional: declutter — remove a single capture from the session. */
  onRemove?: (timestamp: number) => void;
}

function formatTs(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function ConfirmedCapturesPanel({ captures, videoRef, onRemove }: Props) {
  // Newest first — doctor scans recent activity from the top.
  const sorted = useMemo(
    () => [...captures].sort((a, b) => b.timestamp - a.timestamp),
    [captures],
  );

  if (sorted.length === 0) return null;

  const handleSeek = (ts: number) => {
    const v = videoRef.current;
    if (v && Number.isFinite(ts)) {
      try { v.currentTime = ts; } catch { /* video may be unloaded */ }
    }
  };

  return (
    <Box
      sx={{
        mt: 2,
        p: 2,
        borderRadius: '14px',
        backgroundColor: 'background.paper',
        border: '1px solid #E2EAE8',
        boxShadow: '0 2px 12px rgba(13,27,42,0.06)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, color: 'text.secondary', letterSpacing: '0.05em', textTransform: 'uppercase' }}
        >
          Đã xác nhận luôn ({sorted.length})
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.72rem' }}>
          Click để xem lại frame
        </Typography>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, 1fr)',
            sm: 'repeat(3, 1fr)',
            md: 'repeat(4, 1fr)',
          },
          gap: 1.25,
        }}
      >
        {sorted.map((cap) => (
          <Tooltip key={`${cap.trackId}-${cap.timestamp}`} title="Click để xem lại frame này" arrow>
            <Box
              onClick={() => handleSeek(cap.timestamp)}
              sx={{
                position: 'relative',
                borderRadius: '10px',
                overflow: 'hidden',
                cursor: 'pointer',
                border: '1px solid #E2EAE8',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
                '&:hover': {
                  transform: 'translateY(-2px)',
                  boxShadow: '0 6px 16px rgba(0,96,100,0.18)',
                  borderColor: '#006064',
                },
              }}
            >
              {/* Thumbnail */}
              <Box
                sx={{
                  width: '100%',
                  aspectRatio: '4 / 3',
                  backgroundColor: '#0d1117',
                  backgroundImage: cap.frame_b64 ? `url(data:image/jpeg;base64,${cap.frame_b64})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              />

              {/* Remove button (top-right) */}
              {onRemove && (
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); onRemove(cap.timestamp); }}
                  aria-label="Xoá capture này"
                  sx={{
                    position: 'absolute',
                    top: 4, right: 4,
                    backgroundColor: 'rgba(0,0,0,0.55)',
                    color: '#fff',
                    p: 0.4,
                    '&:hover': { backgroundColor: 'rgba(239,68,68,0.85)' },
                  }}
                >
                  <X size={12} />
                </IconButton>
              )}

              {/* Meta line */}
              <Box sx={{ p: 0.75, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
                <Typography
                  sx={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: 'text.primary',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {cap.label}
                </Typography>
                <Typography sx={{ fontSize: '0.7rem', color: '#006064', fontWeight: 700 }}>
                  {(cap.confidence * 100).toFixed(0)}%
                </Typography>
              </Box>
              <Box sx={{ px: 0.75, pb: 0.75, display: 'flex', alignItems: 'center', gap: 0.4 }}>
                <Clock size={10} color="rgba(13,27,42,0.5)" />
                <Typography sx={{ fontSize: '0.68rem', color: 'rgba(13,27,42,0.55)', fontFamily: 'monospace' }}>
                  {formatTs(cap.timestamp)}
                </Typography>
              </Box>
            </Box>
          </Tooltip>
        ))}
      </Box>
    </Box>
  );
}
