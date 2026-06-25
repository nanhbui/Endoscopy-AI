'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Clock,
  HardDrive,
  Loader2,
  Trash2,
  UploadCloud,
  Video,
} from 'lucide-react';
import Box, { type BoxProps } from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiButton from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import {
  deleteLibraryVideo,
  listLibraryVideos,
  uploadToLibrary,
  type LibraryVideo,
} from '@/lib/ws-client';
import { fmtBytes, fmtIsoDateTime } from '@/lib/format';

// ── Types ─────────────────────────────────────────────────────────────────────

interface VideoLibraryPanelProps {
  onSelect: (libraryId: string, filename: string) => void;
  showUploadButton?: boolean;
  sx?: BoxProps['sx'];
}

type Banner =
  | { type: 'duplicate'; filename: string }
  | { type: 'success'; filename: string }
  | { type: 'error'; message: string }
  | { type: 'in-use' };

// ── Component ─────────────────────────────────────────────────────────────────

export function VideoLibraryPanel({ onSelect, showUploadButton = true, sx }: VideoLibraryPanelProps) {
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLibrary = useCallback(async () => {
    setLoading(true);
    try {
      setVideos(await listLibraryVideos());
    } catch {
      setBanner({ type: 'error', message: 'Không thể tải danh sách thư viện.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLibrary(); }, [fetchLibrary]);

  const showBanner = useCallback((b: Banner) => {
    setBanner(b);
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setBanner(null), 4000);
  }, []);

  // ── Upload flow ───────────────────────────────────────────────────────────

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setIsUploading(true);
    setUploadProgress(0);
    try {
      const result = await uploadToLibrary(file, setUploadProgress);
      if (result.duplicate) {
        showBanner({ type: 'duplicate', filename: result.filename });
      } else {
        showBanner({ type: 'success', filename: result.filename });
        await fetchLibrary();
      }
    } catch {
      showBanner({ type: 'error', message: 'Tải lên thất bại. Kiểm tra định dạng hoặc dung lượng máy chủ.' });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [fetchLibrary, showBanner]);

  // ── Delete flow ───────────────────────────────────────────────────────────

  const handleDeleteConfirm = useCallback(async (libraryId: string) => {
    setConfirmDeleteId(null);
    setDeletingId(libraryId);
    try {
      await deleteLibraryVideo(libraryId);
      await fetchLibrary();
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 409) {
        showBanner({ type: 'in-use' });
      } else {
        showBanner({ type: 'error', message: 'Xóa thất bại. Vui lòng thử lại.' });
      }
    } finally {
      setDeletingId(null);
    }
  }, [fetchLibrary, showBanner]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Box
      sx={{
        aspectRatio: '16 / 9',
        width: '100%',
        borderRadius: '16px',
        border: '1px solid #E2EAE8',
        backgroundColor: '#FAFCFB',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...sx,
      }}
    >
      {/* Header */}
      <Box sx={{ px: 2.5, py: 1.5, borderBottom: '1px solid #E2EAE8', display: 'flex', alignItems: 'center', gap: 1.5, backgroundColor: '#F8FAFB' }}>
        <BookOpen size={16} color="#006064" />
        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.primary', flex: 1 }}>
          Thư viện video
        </Typography>
        {showUploadButton && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <MuiButton
              size="small"
              variant="outlined"
              startIcon={isUploading ? <CircularProgress size={12} sx={{ color: 'inherit' }} /> : <UploadCloud size={14} />}
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
              sx={{ borderRadius: '8px', borderColor: '#006064', color: '#006064', fontWeight: 600, fontSize: '0.78rem', textTransform: 'none', '&:hover': { backgroundColor: 'rgba(0,96,100,0.06)' } }}
            >
              {isUploading ? 'Đang tải…' : 'Tải lên mới'}
            </MuiButton>
          </>
        )}
      </Box>

      {/* Upload progress bar — only when upload button is shown */}
      {showUploadButton && isUploading && (
        <LinearProgress
          variant="determinate"
          value={uploadProgress}
          sx={{ height: 3, backgroundColor: 'rgba(0,96,100,0.12)', '& .MuiLinearProgress-bar': { backgroundColor: '#006064' } }}
        />
      )}

      {/* Banner */}
      {banner && (
        <Box sx={{
          px: 2.5, py: 1,
          backgroundColor:
            banner.type === 'success' ? 'rgba(46,125,50,0.08)' :
            banner.type === 'duplicate' ? 'rgba(2,119,189,0.08)' :
            'rgba(211,47,47,0.08)',
          borderBottom: '1px solid',
          borderColor:
            banner.type === 'success' ? 'rgba(46,125,50,0.2)' :
            banner.type === 'duplicate' ? 'rgba(2,119,189,0.2)' :
            'rgba(211,47,47,0.2)',
          display: 'flex', alignItems: 'center', gap: 1,
        }}>
          <CheckCircle2 size={14} color={banner.type === 'success' ? '#2E7D32' : banner.type === 'duplicate' ? '#0277BD' : '#D32F2F'} />
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 500, color: banner.type === 'success' ? '#2E7D32' : banner.type === 'duplicate' ? '#0277BD' : '#D32F2F' }}>
            {banner.type === 'success' && `"${banner.filename}" đã được lưu vào thư viện.`}
            {banner.type === 'duplicate' && `"${banner.filename}" đã có trong thư viện — không cần tải lại.`}
            {banner.type === 'in-use' && 'Video đang được sử dụng, không thể xóa.'}
            {banner.type === 'error' && banner.message}
          </Typography>
        </Box>
      )}

      {/* Content */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: loading || videos.length === 0 ? 0 : 1 }}>
        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 1.5, color: 'text.disabled' }}>
            <Loader2 size={20} className="animate-spin" />
            <Typography variant="caption">Đang tải thư viện…</Typography>
          </Box>
        ) : videos.length === 0 ? (
          /* Empty state */
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2, color: 'text.disabled', px: 4, textAlign: 'center' }}>
            <Video size={36} />
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>
                Thư viện trống
              </Typography>
              <Typography variant="caption" color="textDisabled">
                Nhấn “Tải lên mới” để thêm video đầu tiên vào thư viện.
              </Typography>
            </Box>
          </Box>
        ) : (
          /* Video list */
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {videos.map((video) => (
              <Box
                key={video.library_id}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.5,
                  px: 1.5, py: 1.25, borderRadius: '10px',
                  border: '1px solid transparent',
                  transition: 'all 0.15s ease',
                  '&:hover': { border: '1px solid #C8D8D6', backgroundColor: 'rgba(0,96,100,0.04)' },
                }}
              >
                {/* Icon */}
                <Box sx={{ width: 36, height: 36, borderRadius: '8px', backgroundColor: 'rgba(0,96,100,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#006064', flexShrink: 0 }}>
                  <Video size={16} />
                </Box>

                {/* Info */}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {video.filename}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.25 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, color: 'text.disabled' }}>
                      <HardDrive size={11} />
                      <Typography sx={{ fontSize: '0.7rem' }}>{fmtBytes(video.size_bytes)}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, color: 'text.disabled' }}>
                      <Clock size={11} />
                      <Typography sx={{ fontSize: '0.7rem' }}>{fmtIsoDateTime(video.uploaded_at)}</Typography>
                    </Box>
                  </Box>
                </Box>

                {/* Actions */}
                {confirmDeleteId === video.library_id ? (
                  <Box sx={{ display: 'flex', gap: 0.75, flexShrink: 0 }}>
                    <MuiButton size="small" variant="contained"
                      onClick={() => handleDeleteConfirm(video.library_id)}
                      disabled={deletingId === video.library_id}
                      sx={{ borderRadius: '7px', backgroundColor: '#D32F2F', fontWeight: 700, fontSize: '0.72rem', py: 0.4, px: 1, '&:hover': { backgroundColor: '#B71C1C' } }}>
                      Xóa vĩnh viễn
                    </MuiButton>
                    <MuiButton size="small" onClick={() => setConfirmDeleteId(null)}
                      sx={{ borderRadius: '7px', color: 'text.secondary', fontWeight: 600, fontSize: '0.72rem', py: 0.4, px: 1 }}>
                      Hủy
                    </MuiButton>
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', gap: 0.75, flexShrink: 0 }}>
                    <MuiButton size="small" variant="contained"
                      onClick={() => onSelect(video.library_id, video.filename)}
                      sx={{ borderRadius: '7px', backgroundColor: '#006064', fontWeight: 700, fontSize: '0.72rem', py: 0.4, px: 1.25, whiteSpace: 'nowrap', '&:hover': { backgroundColor: '#004D52' } }}>
                      Chọn
                    </MuiButton>
                    <MuiButton size="small"
                      disabled={deletingId === video.library_id}
                      onClick={() => setConfirmDeleteId(video.library_id)}
                      sx={{ borderRadius: '7px', color: 'text.disabled', minWidth: 0, px: 0.75, '&:hover': { color: '#D32F2F', backgroundColor: 'rgba(211,47,47,0.06)' } }}>
                      {deletingId === video.library_id
                        ? <CircularProgress size={14} sx={{ color: '#D32F2F' }} />
                        : <Trash2 size={14} />}
                    </MuiButton>
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
