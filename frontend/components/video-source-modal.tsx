'use client';

import { useCallback, useRef, useState } from 'react';
import { CheckCircle2, UploadCloud, X } from 'lucide-react';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { uploadToLibrary } from '@/lib/ws-client';
import { VideoLibraryPanel } from '@/components/video-library-panel';
import { RecordingsPanel } from '@/components/recordings-panel';

// ── UploadZone (moved from workspace/page.tsx) ────────────────────────────────

interface UploadZoneProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}

function UploadZone({ onFileSelected, disabled }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0 || disabled) return;
      onFileSelected(files[0]);
    },
    [onFileSelected, disabled],
  );

  return (
    <Box
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
      sx={{
        borderRadius: '12px',
        border: `2px dashed ${isDragging ? '#006064' : '#C8D8D6'}`,
        backgroundColor: isDragging ? 'rgba(0,96,100,0.05)' : '#FAFCFB',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.5,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.2s ease',
        py: 4,
        opacity: disabled ? 0.5 : 1,
        '&:hover': disabled ? {} : { borderColor: '#006064', backgroundColor: 'rgba(0,96,100,0.04)' },
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <Box sx={{ width: 48, height: 48, borderRadius: '12px', backgroundColor: 'rgba(0,96,100,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#006064' }}>
        <UploadCloud size={24} />
      </Box>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.25 }}>
          {isDragging ? 'Thả file vào đây' : 'Tải video lên để phân tích'}
        </Typography>
        <Typography variant="caption" color="textSecondary">
          Kéo thả hoặc nhấp để chọn · MP4, MOV, AVI, MKV
        </Typography>
      </Box>
    </Box>
  );
}

// ── UploadingProgress (moved from workspace/page.tsx) ────────────────────────

function UploadingProgress({ fileName, progress }: { fileName: string; progress: number }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, px: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <CircularProgress size={18} thickness={4} sx={{ color: '#006064', flexShrink: 0 }} />
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {fileName}
        </Typography>
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: '#006064', flexShrink: 0 }}>
          {progress}%
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={progress}
        sx={{ height: 5, borderRadius: 3, backgroundColor: 'rgba(0,96,100,0.1)', '& .MuiLinearProgress-bar': { backgroundColor: '#006064', borderRadius: 3 } }}
      />
      <Typography variant="caption" color="textSecondary">Đang tải lên máy chủ…</Typography>
    </Box>
  );
}

// ── VideoSourceModal ──────────────────────────────────────────────────────────

export interface VideoSourceModalProps {
  open: boolean;
  onClose: () => void;
  /** Called when a session-only upload finishes — parent creates objectURL and calls uploadAndConnect */
  onUploadAndConnect: (file: File, onProgress: (pct: number) => void) => Promise<void>;
  /** Called when a library video is selected. localFile is provided when the user just uploaded
   *  with "Lưu vào thư viện" checked — allows the workspace to show a local preview.
   *  filename is the library video's original filename (used as session name in history). */
  onLibrarySelect: (libraryId: string, localFile?: File, filename?: string) => void;
}

export function VideoSourceModal({ open, onClose, onUploadAndConnect, onLibrarySelect }: VideoSourceModalProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [uploadingFileName, setUploadingFileName] = useState('');
  const [duplicateBanner, setDuplicateBanner] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<'library' | 'recordings'>('library');

  const handleFileSelected = useCallback(async (file: File) => {
    if (!file.type.startsWith('video/')) {
      setUploadError('Định dạng không được hỗ trợ. Vui lòng chọn file MP4, MOV, AVI hoặc MKV.');
      return;
    }
    setUploadError(null);
    setDuplicateBanner(null);
    setUploadingFileName(file.name);
    setIsUploading(true);
    setUploadProgress(0);
    try {
      if (saveToLibrary) {
        const result = await uploadToLibrary(file, setUploadProgress);
        if (result.duplicate) {
          setDuplicateBanner(`"${result.filename}" đã có trong thư viện — phiên phân tích bắt đầu.`);
        }
        onLibrarySelect(result.library_id, file, result.filename);
        onClose();
      } else {
        await onUploadAndConnect(file, setUploadProgress);
        onClose();
      }
    } catch {
      setUploadError('Tải lên thất bại. Kiểm tra định dạng hoặc kết nối máy chủ.');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [saveToLibrary, onUploadAndConnect, onLibrarySelect, onClose]);

  const handleLibrarySelectInternal = useCallback((libraryId: string, filename: string) => {
    onLibrarySelect(libraryId, undefined, filename);
    onClose();
  }, [onLibrarySelect, onClose]);

  const handleClose = useCallback(() => {
    if (!isUploading) onClose();
  }, [isUploading, onClose]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="lg"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: '20px', overflow: 'hidden', height: '80vh' } } }}
    >
      {/* Header */}
      <Box sx={{ px: 3, py: 2, borderBottom: '1px solid #E2EAE8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F8FAFB', flexShrink: 0 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>
          Chọn nguồn video
        </Typography>
        <IconButton size="small" onClick={handleClose} disabled={isUploading} sx={{ color: 'text.secondary', '&:hover': { backgroundColor: 'rgba(0,0,0,0.06)' } }}>
          <X size={18} />
        </IconButton>
      </Box>

      <DialogContent sx={{ p: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1 }}>
        <Grid container sx={{ flex: 1, height: '100%', overflow: 'hidden' }}>

          {/* ── Library / Recordings section (left) ───────────────────────── */}
          <Grid
            size={{ xs: 12, md: 7 }}
            sx={{ borderRight: { md: '1px solid #E2EAE8' }, overflowY: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}
          >
            {/* Tab switcher */}
            <Box sx={{ display: 'flex', gap: 0.5, px: 1.5, pt: 1.5, pb: 1, borderBottom: '1px solid #E2EAE8', backgroundColor: '#F8FAFB', flexShrink: 0 }}>
              {([
                { id: 'library', label: 'Thư viện video' },
                { id: 'recordings', label: 'Bản ghi trực tiếp' },
              ] as const).map((t) => (
                <Box key={t.id} component="button" onClick={() => setLeftTab(t.id)}
                  sx={{ px: 1.75, py: 0.75, borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700,
                    backgroundColor: leftTab === t.id ? '#006064' : 'transparent',
                    color: leftTab === t.id ? '#fff' : 'text.secondary',
                    '&:hover': leftTab === t.id ? {} : { backgroundColor: 'rgba(0,96,100,0.06)' } }}>
                  {t.label}
                </Box>
              ))}
            </Box>
            <Box sx={{ flex: 1, minHeight: 0 }}>
              {leftTab === 'library' ? (
                <VideoLibraryPanel
                  showUploadButton={false}
                  onSelect={handleLibrarySelectInternal}
                  sx={{ aspectRatio: 'unset', borderRadius: 0, border: 'none', height: '100%' }}
                />
              ) : (
                <RecordingsPanel onSelect={handleLibrarySelectInternal} />
              )}
            </Box>
          </Grid>

          {/* ── Upload section (right) ────────────────────────────────────── */}
          <Grid size={{ xs: 12, md: 5 }} sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2, borderTop: { xs: '1px solid #E2EAE8', md: 'none' }, height: '100%', overflowY: 'auto' }}>
            <Typography variant="caption" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}>
              Tải video mới
            </Typography>

            {isUploading ? (
              <UploadingProgress fileName={uploadingFileName} progress={uploadProgress} />
            ) : (
              <>
                <UploadZone onFileSelected={handleFileSelected} />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={saveToLibrary}
                      onChange={(e) => setSaveToLibrary(e.target.checked)}
                      size="small"
                      sx={{ color: '#9AA5B1', '&.Mui-checked': { color: '#006064' } }}
                    />
                  }
                  label={
                    <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary' }}>
                      Lưu vào thư viện
                    </Typography>
                  }
                  sx={{ mx: 0 }}
                />

                {/* Duplicate banner (US4) */}
                {duplicateBanner && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderRadius: '8px', backgroundColor: 'rgba(2,119,189,0.08)', border: '1px solid rgba(2,119,189,0.2)' }}>
                    <CheckCircle2 size={13} color="#0277BD" />
                    <Typography sx={{ fontSize: '0.75rem', color: '#0277BD', fontWeight: 500 }}>{duplicateBanner}</Typography>
                  </Box>
                )}

                {/* Upload error */}
                {uploadError && (
                  <Typography sx={{ fontSize: '0.78rem', color: '#D32F2F', fontWeight: 500 }}>
                    {uploadError}
                  </Typography>
                )}
              </>
            )}
          </Grid>

        </Grid>
      </DialogContent>
    </Dialog>
  );
}
