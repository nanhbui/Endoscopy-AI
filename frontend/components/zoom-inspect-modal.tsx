'use client';

/**
 * zoom-inspect-modal.tsx — Phase 05 (Kiểm tra lại)
 *
 * Opens when BE emits RECHECK_RESULT (multi-bbox payload). Shows:
 *  - left: full paused frame with all bboxes overlaid (click to focus)
 *  - right: 3x zoom crop of focused bbox
 *  - footer: timeline slider ±5s (click-seek workspace video)
 *
 * MVP scope: visual inspection only. After closing, doctor goes back to the
 * underlying DetectionBar to make the actual decision (Xác nhận / Báo sai /
 * Bỏ qua). Recheck-origin bboxes have track_id = -1 so the auto-track
 * actions ("Xác nhận luôn") cannot apply to them anyway.
 */

import { useEffect, useMemo, useState, type RefObject } from 'react';
import { X } from 'lucide-react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import type { RecheckResultPayload } from '@/context/AnalysisContext';

interface Props {
  open: boolean;
  payload: RecheckResultPayload | null;
  /** Workspace video element. Kept for API compatibility with the caller;
   *  no longer used since the ±5s scrubber was removed. */
  videoRef?: RefObject<HTMLVideoElement | null>;
  onClose: () => void;
}

// Source coordinate system from BE (matches AnalysisContext FRAME_W/H constants)
const FRAME_W = 1920;
const FRAME_H = 1080;

export function ZoomInspectModal({ open, payload, onClose }: Props) {
  const [focusedIdx, setFocusedIdx] = useState(0);

  // Reset focus when a fresh payload arrives.
  useEffect(() => {
    if (!payload) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset focus when a new payload arrives
    setFocusedIdx(0);
  }, [payload]);

  // ESC + arrow keys
  useEffect(() => {
    if (!open || !payload) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowRight') {
        setFocusedIdx((i) => Math.min(payload.boxes.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft') {
        setFocusedIdx((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, payload, onClose]);

  const focused = payload?.boxes[focusedIdx];

  // Focused crop as a percentage rectangle (for the right-pane zoom).
  const cropPct = useMemo(() => {
    if (!focused) return null;
    const [x1, y1, x2, y2] = focused.bbox;
    return {
      x: (x1 / FRAME_W) * 100,
      y: (y1 / FRAME_H) * 100,
      width: ((x2 - x1) / FRAME_W) * 100,
      height: ((y2 - y1) / FRAME_H) * 100,
    };
  }, [focused]);

  if (!payload) return null;

  const frameSrc = payload.frameB64Full ? `data:image/jpeg;base64,${payload.frameB64Full}` : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: '16px', overflow: 'hidden', height: '88vh' } } }}
    >
      {/* Header */}
      <Box sx={{ px: 3, py: 1.5, borderBottom: '1px solid #E2EAE8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F8FAFB' }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>
            Kiểm tra lại — {payload.boxes.length} vùng tìm thấy ở ngưỡng {payload.conf.toFixed(2)}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Click bbox để focus · ←/→ chuyển focus · Esc đóng
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Đóng">
          <X size={18} />
        </IconButton>
      </Box>

      {/* 2-pane body */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1, p: 1.5 }}>
        {/* Left — full frame + bbox overlays */}
        <Box sx={{ position: 'relative', backgroundColor: '#0d1117', borderRadius: '10px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {frameSrc ? (
            <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
              <Box
                component="img"
                src={frameSrc}
                alt="Paused frame"
                sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
              />
              {/* Bbox overlays — coords are in 1920×1080 virtual frame */}
              {payload.boxes.map((b, i) => {
                const [x1, y1, x2, y2] = b.bbox;
                const isFocus = i === focusedIdx;
                return (
                  <Box
                    key={i}
                    onClick={() => setFocusedIdx(i)}
                    sx={{
                      position: 'absolute',
                      left: `${(x1 / FRAME_W) * 100}%`,
                      top: `${(y1 / FRAME_H) * 100}%`,
                      width: `${((x2 - x1) / FRAME_W) * 100}%`,
                      height: `${((y2 - y1) / FRAME_H) * 100}%`,
                      border: `${isFocus ? 3 : 2}px solid ${isFocus ? '#F59E0B' : '#3B82F6'}`,
                      boxShadow: isFocus ? '0 0 0 2px rgba(245,158,11,0.4)' : undefined,
                      cursor: 'pointer',
                      backgroundColor: isFocus ? 'rgba(245,158,11,0.08)' : 'rgba(59,130,246,0.04)',
                    }}
                  >
                    <Box sx={{ position: 'absolute', top: -22, left: -1, backgroundColor: isFocus ? '#F59E0B' : '#3B82F6', color: '#000', px: 0.75, fontSize: '0.65rem', fontWeight: 700, borderRadius: '4px 4px 0 0' }}>
                      #{i + 1} {b.label} {(b.confidence * 100).toFixed(0)}%
                    </Box>
                  </Box>
                );
              })}
            </Box>
          ) : (
            <Typography sx={{ color: 'rgba(255,255,255,0.5)' }}>Không có frame để hiển thị</Typography>
          )}
        </Box>

        {/* Right — zoom of focused bbox (CSS clip + scale) */}
        <Box sx={{ position: 'relative', backgroundColor: '#0d1117', borderRadius: '10px', overflow: 'hidden' }}>
          {frameSrc && cropPct ? (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                backgroundImage: `url(${frameSrc})`,
                backgroundSize: `${(100 / cropPct.width) * 100}% ${(100 / cropPct.height) * 100}%`,
                backgroundPosition: `${(cropPct.x / (100 - cropPct.width)) * 100}% ${(cropPct.y / (100 - cropPct.height)) * 100}%`,
                backgroundRepeat: 'no-repeat',
              }}
            />
          ) : (
            <Typography sx={{ color: 'rgba(255,255,255,0.5)', position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              Click 1 bbox để zoom
            </Typography>
          )}
          {focused && (
            <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, px: 2, py: 1, backgroundColor: 'rgba(13,17,23,0.85)', backdropFilter: 'blur(8px)', color: '#fff' }}>
              <Typography sx={{ fontSize: '0.85rem', fontWeight: 700 }}>
                {focused.label}
              </Typography>
              <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.6)' }}>
                Confidence {(focused.confidence * 100).toFixed(1)}% · bbox #{focusedIdx + 1}/{payload.boxes.length}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* Footer — hint only (the ±5s scrubber was removed: it seeked the hidden
          workspace video behind the modal and the static frame didn't update,
          so it had no visible effect). */}
      <Box sx={{ px: 3, py: 1.5, borderTop: '1px solid #E2EAE8', backgroundColor: '#F8FAFB' }}>
        <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '0.7rem', display: 'block' }}>
          Đóng modal rồi quyết định (Xác nhận luôn / Báo sai / Bỏ qua) ở thanh dưới video.
        </Typography>
      </Box>
    </Dialog>
  );
}
