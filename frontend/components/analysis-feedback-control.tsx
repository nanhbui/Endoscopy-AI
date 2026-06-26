'use client';

/**
 * analysis-feedback-control.tsx — "Báo sai phân tích" (flag the AI ANALYSIS as
 * wrong, separate from flagging the detection). Opens a menu with 3 choices:
 *   - Phân tích lại  → re-run the VLM on the same frame
 *   - Tự sửa         → edit the analysis text (sent verbatim to the summary)
 *   - Để trống       → drop the analysis (lesion still counts as a finding)
 * Each produces a new LesionReport handed back via onApply; the caller persists
 * it (local state for live pre-finalize, or the report endpoint for video).
 */

import { useState } from 'react';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import { Flag, RefreshCw, Pencil, Eraser } from 'lucide-react';
import type { LesionReport } from '@/lib/ws-client';
import { reanalyzeReport, withEditedText, clearedReport, reportToEditableText } from '@/lib/lesion-report-edits';

interface Props {
  report: LesionReport;
  label: string;
  confidence: number;
  /** JPEG base64 (no prefix). When absent, "Phân tích lại" is hidden. */
  frameB64?: string;
  onApply: (next: LesionReport) => void | Promise<void>;
  /** 'icon' = compact icon button; 'text' = labeled outlined button (default). */
  variant?: 'icon' | 'text';
}

export function AnalysisFeedbackControl({ report, label, confidence, frameB64, onApply, variant = 'text' }: Props) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const close = () => setAnchor(null);

  const apply = async (next: LesionReport) => {
    setBusy(true);
    try { await onApply(next); } finally { setBusy(false); }
  };

  const onReanalyze = async () => {
    close();
    if (!frameB64) return;
    setBusy(true);
    try {
      const next = await reanalyzeReport(frameB64, label, confidence);
      await onApply(next);
    } catch { /* leave the old analysis in place on failure */ }
    finally { setBusy(false); }
  };

  const openEdit = () => { setDraft(reportToEditableText(report)); setEditOpen(true); close(); };
  const saveEdit = async () => { setEditOpen(false); await apply(withEditedText(report, draft.trim())); };
  const onClear = async () => { close(); await apply(clearedReport(label, report.conclusion?.severity)); };

  return (
    <>
      {variant === 'icon' ? (
        <Tooltip title="Báo sai phân tích AI" arrow>
          <span>
            <IconButton size="small" disabled={busy} onClick={(e) => setAnchor(e.currentTarget)}
              aria-label="Báo sai phân tích AI"
              sx={{ color: '#DC2626', border: '1px solid rgba(220,38,38,0.35)', borderRadius: '7px', p: 0.5, '&:hover': { backgroundColor: 'rgba(220,38,38,0.1)', borderColor: '#DC2626' } }}>
              {busy ? <CircularProgress size={14} sx={{ color: '#DC2626' }} /> : <Flag size={14} />}
            </IconButton>
          </span>
        </Tooltip>
      ) : (
        <Button size="small" variant="outlined" disabled={busy}
          startIcon={busy ? <CircularProgress size={13} sx={{ color: 'inherit' }} /> : <Flag size={14} />}
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{ borderRadius: '8px', textTransform: 'none', fontWeight: 700, fontSize: '0.74rem',
            color: '#DC2626', borderColor: 'rgba(220,38,38,0.4)',
            '&:hover': { borderColor: '#DC2626', backgroundColor: 'rgba(220,38,38,0.06)' } }}>
          Báo sai phân tích
        </Button>
      )}

      <Menu anchorEl={anchor} open={!!anchor} onClose={close}
        slotProps={{ paper: { sx: { borderRadius: '10px', minWidth: 210 } } }}>
        {frameB64 && (
          <MenuItem onClick={onReanalyze} sx={{ fontSize: '0.82rem' }}>
            <ListItemIcon><RefreshCw size={15} color="#0277BD" /></ListItemIcon>
            Phân tích lại (AI chạy lại)
          </MenuItem>
        )}
        <MenuItem onClick={openEdit} sx={{ fontSize: '0.82rem' }}>
          <ListItemIcon><Pencil size={15} color="#006064" /></ListItemIcon>
          Tự sửa phân tích
        </MenuItem>
        <MenuItem onClick={onClear} sx={{ fontSize: '0.82rem', color: '#B91C1C' }}>
          <ListItemIcon><Eraser size={15} color="#B91C1C" /></ListItemIcon>
          Để trống (giữ là phát hiện)
        </MenuItem>
      </Menu>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} fullWidth maxWidth="sm"
        slotProps={{ paper: { sx: { borderRadius: '14px' } } }}>
        <DialogTitle sx={{ fontWeight: 800, fontSize: '1rem' }}>Sửa phân tích — {label}</DialogTitle>
        <DialogContent>
          <TextField value={draft} onChange={(e) => setDraft(e.target.value)} multiline minRows={8} fullWidth autoFocus
            placeholder="Nhập phân tích đúng — bản này sẽ được dùng cho tổng hợp AI."
            sx={{ mt: 0.5, '& .MuiInputBase-input': { fontSize: '0.85rem', lineHeight: 1.6 } }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditOpen(false)} sx={{ textTransform: 'none', color: 'text.secondary' }}>Huỷ</Button>
          <Button onClick={saveEdit} variant="contained" disabled={!draft.trim()}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px', backgroundColor: '#006064', '&:hover': { backgroundColor: '#004D51' } }}>
            Lưu bản sửa
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
