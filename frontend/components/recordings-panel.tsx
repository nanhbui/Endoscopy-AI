'use client';

/**
 * recordings-panel.tsx — "Bản ghi trực tiếp" list + inline replay.
 *
 * Lists library videos tagged source=live_recording (auto-saved from a live
 * Trực tiếp session), plays them inline via /library/{id}/video, and offers
 * "Phân tích lại" (re-run through the upload pipeline) + delete. Mirrors
 * VideoLibraryPanel's visual language but is recording-specific.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, HardDrive, Loader2, Play, Radio, Trash2 } from 'lucide-react';
import Box, { type BoxProps } from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiButton from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import {
  deleteLibraryVideo,
  libraryVideoUrl,
  listLibraryVideos,
  type LibraryVideo,
} from '@/lib/ws-client';
import { fmtBytes, fmtIsoDateTime, fmtDurationMs } from '@/lib/format';

interface RecordingsPanelProps {
  /** Re-analyze a recording: runs it through the same pipeline as a library video. */
  onSelect: (libraryId: string, filename: string) => void;
  sx?: BoxProps['sx'];
}

export function RecordingsPanel({ onSelect, sx }: RecordingsPanelProps) {
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const fetchRecordings = useCallback(async () => {
    setLoading(true);
    try {
      setVideos(await listLibraryVideos('live_recording'));
      setError('');
    } catch {
      setError('Không thể tải danh sách bản ghi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRecordings(); }, [fetchRecordings]);

  const handleDelete = useCallback(async (libraryId: string) => {
    setConfirmDeleteId(null);
    setDeletingId(libraryId);
    try {
      await deleteLibraryVideo(libraryId);
      if (playingId === libraryId) setPlayingId(null);
      await fetchRecordings();
    } catch {
      setError('Xóa thất bại. Vui lòng thử lại.');
    } finally {
      setDeletingId(null);
    }
  }, [fetchRecordings, playingId]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', ...sx }}>
      {/* Inline player — shown when a recording is selected */}
      {playingId && (
        <Box sx={{ p: 1.5, borderBottom: '1px solid #E2EAE8', backgroundColor: '#0D1117' }}>
          <video
            ref={videoRef}
            key={playingId}
            src={libraryVideoUrl(playingId)}
            controls
            autoPlay
            style={{ width: '100%', maxHeight: 320, borderRadius: 10, background: '#000' }}
          />
        </Box>
      )}

      {error && (
        <Typography sx={{ px: 2.5, py: 1, fontSize: '0.78rem', color: '#D32F2F' }}>{error}</Typography>
      )}

      <Box sx={{ flex: 1, overflowY: 'auto', p: loading || videos.length === 0 ? 0 : 1 }}>
        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 1.5, color: 'text.disabled' }}>
            <Loader2 size={20} className="animate-spin" />
            <Typography variant="caption">Đang tải bản ghi…</Typography>
          </Box>
        ) : videos.length === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2, color: 'text.disabled', px: 4, textAlign: 'center' }}>
            <Radio size={36} />
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>
                Chưa có bản ghi
              </Typography>
              <Typography variant="caption" color="textDisabled">
                Bản ghi sẽ tự xuất hiện sau khi bạn chạy một phiên Trực tiếp và bấm “Dừng phiên”.
              </Typography>
            </Box>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {videos.map((v) => {
              const dur = fmtDurationMs(v.duration_ms);
              return (
                <Box key={v.library_id}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1.25, borderRadius: '10px',
                    border: playingId === v.library_id ? '1px solid #A7D8DC' : '1px solid transparent',
                    backgroundColor: playingId === v.library_id ? 'rgba(0,131,143,0.05)' : 'transparent',
                    transition: 'all 0.15s ease',
                    '&:hover': { border: '1px solid #C8D8D6', backgroundColor: 'rgba(0,96,100,0.04)' } }}>
                  <Box sx={{ width: 36, height: 36, borderRadius: '8px', backgroundColor: 'rgba(220,38,38,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#DC2626', flexShrink: 0 }}>
                    <Radio size={16} />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.filename}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.25, color: 'text.disabled' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                        <Clock size={11} />
                        <Typography sx={{ fontSize: '0.7rem' }}>{fmtIsoDateTime(v.recorded_at || v.uploaded_at)}</Typography>
                      </Box>
                      {dur && <Typography sx={{ fontSize: '0.7rem' }}>· {dur}</Typography>}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                        <HardDrive size={11} />
                        <Typography sx={{ fontSize: '0.7rem' }}>{fmtBytes(v.size_bytes)}</Typography>
                      </Box>
                    </Box>
                  </Box>
                  {confirmDeleteId === v.library_id ? (
                    <Box sx={{ display: 'flex', gap: 0.75, flexShrink: 0 }}>
                      <MuiButton size="small" variant="contained" onClick={() => handleDelete(v.library_id)} disabled={deletingId === v.library_id}
                        sx={{ borderRadius: '7px', backgroundColor: '#D32F2F', fontWeight: 700, fontSize: '0.72rem', py: 0.4, px: 1, '&:hover': { backgroundColor: '#B71C1C' } }}>
                        Xóa vĩnh viễn
                      </MuiButton>
                      <MuiButton size="small" onClick={() => setConfirmDeleteId(null)} sx={{ borderRadius: '7px', color: 'text.secondary', fontWeight: 600, fontSize: '0.72rem', py: 0.4, px: 1 }}>
                        Hủy
                      </MuiButton>
                    </Box>
                  ) : (
                    <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0, alignItems: 'center' }}>
                      <MuiButton size="small" variant="outlined" startIcon={<Play size={13} />}
                        onClick={() => setPlayingId(v.library_id)}
                        sx={{ borderRadius: '7px', borderColor: '#00838F', color: '#00838F', fontWeight: 700, fontSize: '0.72rem', py: 0.4, px: 1, whiteSpace: 'nowrap', '&:hover': { backgroundColor: 'rgba(0,131,143,0.06)' } }}>
                        Xem lại
                      </MuiButton>
                      <MuiButton size="small" variant="contained" onClick={() => onSelect(v.library_id, v.filename)}
                        sx={{ borderRadius: '7px', backgroundColor: '#006064', fontWeight: 700, fontSize: '0.72rem', py: 0.4, px: 1, whiteSpace: 'nowrap', '&:hover': { backgroundColor: '#004D52' } }}>
                        Phân tích lại
                      </MuiButton>
                      <MuiButton size="small" disabled={deletingId === v.library_id} onClick={() => setConfirmDeleteId(v.library_id)}
                        sx={{ borderRadius: '7px', color: 'text.disabled', minWidth: 0, px: 0.75, '&:hover': { color: '#D32F2F', backgroundColor: 'rgba(211,47,47,0.06)' } }}>
                        {deletingId === v.library_id ? <CircularProgress size={14} sx={{ color: '#D32F2F' }} /> : <Trash2 size={14} />}
                      </MuiButton>
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}
