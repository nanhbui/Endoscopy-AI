'use client';

import Link from 'next/link';
import { motion as framMotion } from 'framer-motion';
import {
  Activity,
  ArrowRight,
  Brain,
  ClipboardList,
  MessageSquareText,
  Play,
  ScanSearch,
  UploadCloud,
} from 'lucide-react';
import { PipelineGraphSection } from '@/components/pipeline-graph-section';

import { useAnalysis } from '@/context/AnalysisContext';

import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid';
import MuiButton from '@mui/material/Button';

const workflowFeatures = [
  {
    title: 'Phân tích Real-time',
    description: 'Xử lý video tốc độ cao, nhận diện tổn thương ngay lập tức với độ chính xác cao.',
    icon: Activity,
    color: '#0277BD',
    bg: 'rgba(2,119,189,0.08)',
  },
  {
    title: 'Smart Ignore & Memory',
    description: 'Tự động ghi nhớ các điểm đã bỏ qua, không cảnh báo lặp lại trong cùng phiên.',
    icon: Brain,
    color: '#006064',
    bg: 'rgba(0,96,100,0.08)',
  },
  {
    title: 'Trợ lý Y khoa LLM',
    description: 'Tự động sinh phân loại y khoa và checklist hành động phù hợp cho bác sĩ lâm sàng.',
    icon: MessageSquareText,
    color: '#2E7D32',
    bg: 'rgba(46,125,50,0.08)',
  },
];

const MotionBox = framMotion(Box);

export default function Home() {
  const { isPlaying, detections } = useAnalysis();

  return (
    <Box sx={{ minHeight: 'calc(100vh - 130px)', py: 5, px: { xs: 2, sm: 3, lg: 4 }, backgroundColor: 'background.default' }}>
      <Container maxWidth="lg" sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>

        {/* ── Hero ── */}
        <MotionBox
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          sx={{
            borderRadius: '20px',
            overflow: 'hidden',
            position: 'relative',
            background: 'linear-gradient(135deg, #004044 0%, #006064 45%, #00838F 100%)',
            p: { xs: 3, lg: 5 },
            color: '#fff',
          }}
        >
          <Box sx={{ position: 'absolute', top: -60, right: -60, width: 280, height: 280, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />
          <Box sx={{ position: 'absolute', bottom: -80, right: 80, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', pointerEvents: 'none' }} />

          <Box sx={{ position: 'relative', zIndex: 1 }}>
            <Typography
              variant="h1"
              sx={{ fontSize: { xs: '1.75rem', md: '2.5rem' }, fontWeight: 800, mb: 1.5, lineHeight: 1.25, color: '#fff' }}
            >
              Hệ thống Phân tích Nội soi Thông minh
            </Typography>
            <Typography
              sx={{ mb: 4, maxWidth: 640, lineHeight: 1.7, color: 'rgba(255,255,255,0.78)', fontSize: '0.9375rem' }}
            >
              GStreamer · YOLO · Whisper · LLM — phát hiện tổn thương theo thời gian thực, hands-free, voice-first.
            </Typography>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
              <MuiButton
                component={Link}
                href="/workspace"
                variant="contained"
                size="large"
                startIcon={<UploadCloud size={18} />}
                sx={{
                  backgroundColor: '#fff',
                  color: '#006064',
                  fontWeight: 700,
                  borderRadius: '10px',
                  px: 3,
                  boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
                  '&:hover': { backgroundColor: '#f0fafa', boxShadow: '0 6px 24px rgba(0,0,0,0.3)' },
                }}
              >
                Tải video & Bắt đầu
              </MuiButton>
              {detections.length > 0 && (
                <MuiButton
                  component={Link}
                  href="/report"
                  variant="outlined"
                  size="large"
                  endIcon={<ArrowRight size={16} />}
                  sx={{
                    borderColor: 'rgba(255,255,255,0.45)',
                    color: '#fff',
                    borderRadius: '10px',
                    px: 3,
                    '&:hover': { borderColor: '#fff', backgroundColor: 'rgba(255,255,255,0.1)' },
                  }}
                >
                  Xem báo cáo ({detections.length} phát hiện)
                </MuiButton>
              )}
            </Box>
          </Box>
        </MotionBox>

        {/* ── Session summary (shown only when detections exist) ── */}
        {detections.length > 0 ? (
          <Box
            sx={{
              backgroundColor: 'background.paper',
              borderRadius: '16px',
              border: '1px solid #E2EAE8',
              boxShadow: '0 2px 12px rgba(13,27,42,0.06)',
              p: 3,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>
                Phiên hiện tại
              </Typography>
              <Typography variant="body2" color="textSecondary">
                {detections.length} tổn thương đã phát hiện · {isPlaying ? 'Đang phân tích' : 'Đã dừng'}
              </Typography>
            </Box>
            <MuiButton
              component={Link}
              href="/report"
              variant="contained"
              endIcon={<ArrowRight size={16} />}
              sx={{ borderRadius: '10px', fontWeight: 700 }}
            >
              Xem báo cáo
            </MuiButton>
          </Box>
        ) : (
          <Box
            sx={{
              backgroundColor: 'background.paper',
              borderRadius: '16px',
              border: '1px dashed #C8D8D6',
              p: 4,
              textAlign: 'center',
            }}
          >
            <Play size={32} color="#C8D8D6" style={{ marginBottom: 12 }} />
            <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 0.5 }}>
              Chưa có phiên phân tích nào
            </Typography>
            <Typography variant="caption" color="textDisabled">
              Tải video lên ở Workspace để bắt đầu
            </Typography>
          </Box>
        )}

        {/* ── Features ── */}
        <Box>
          <Typography variant="h3" sx={{ fontSize: '1.25rem', fontWeight: 700, mb: 2.5, color: 'text.primary' }}>
            Luồng tính năng
          </Typography>
          <Grid container spacing={2.5}>
            {workflowFeatures.map((feature, idx) => (
              <Grid size={{ xs: 12, md: 4 }} key={feature.title}>
                <MotionBox
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: idx * 0.08 }}
                  sx={{
                    height: '100%',
                    backgroundColor: 'background.paper',
                    borderRadius: '16px',
                    border: '1px solid #E2EAE8',
                    boxShadow: '0 2px 12px rgba(13,27,42,0.06)',
                    p: 3,
                    transition: 'box-shadow 0.2s, transform 0.2s',
                    '&:hover': { boxShadow: '0 8px 28px rgba(13,27,42,0.1)', transform: 'translateY(-2px)' },
                  }}
                >
                  <Box
                    sx={{
                      width: 44, height: 44, borderRadius: '12px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      backgroundColor: feature.bg, color: feature.color, mb: 2,
                    }}
                  >
                    <feature.icon size={22} />
                  </Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1, color: 'text.primary' }}>
                    {feature.title}
                  </Typography>
                  <Typography variant="body2" color="textSecondary" sx={{ lineHeight: 1.65 }}>
                    {feature.description}
                  </Typography>
                </MotionBox>
              </Grid>
            ))}
          </Grid>
        </Box>

        {/* ── Detection report table ── */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2.5 }}>
            <ClipboardList size={18} color="#006064" />
            <Typography variant="h3" sx={{ fontSize: '1.25rem', fontWeight: 700, color: 'text.primary' }}>
              Báo cáo phiên hiện tại
            </Typography>
          </Box>
          <Box sx={{ backgroundColor: 'background.paper', borderRadius: '16px', border: '1px solid #E2EAE8', boxShadow: '0 2px 12px rgba(13,27,42,0.06)', overflow: 'hidden' }}>
            {/* Table header */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', px: 3, py: 1.5, backgroundColor: '#F8FAFB', borderBottom: '1px solid #E2EAE8' }}>
              {['Thời điểm', 'Chẩn đoán AI', 'Độ tin cậy'].map((h) => (
                <Typography key={h} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{h}</Typography>
              ))}
            </Box>

            {detections.length === 0 ? (
              <Box sx={{ py: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
                <ScanSearch size={32} color="#C8D8D6" />
                <Typography variant="body2" color="textSecondary">Chưa có phát hiện nào trong phiên này</Typography>
                <Typography variant="caption" color="textDisabled">Tải video lên ở Workspace để bắt đầu phân tích</Typography>
              </Box>
            ) : (
              <>
                {detections.map((det, idx) => (
                  <Box key={`row-${idx}`} sx={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', px: 3, py: 1.75, alignItems: 'center', borderBottom: idx < detections.length - 1 ? '1px solid #F0F4F3' : 'none', '&:hover': { backgroundColor: '#F8FAFB' } }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary', fontWeight: 500 }}>{det.timestamp.toFixed(1)}s</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <ScanSearch size={14} color="#006064" />
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>{det.label}</Typography>
                    </Box>
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.4, borderRadius: '6px', backgroundColor: 'rgba(46,125,50,0.08)', width: 'fit-content' }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: '#2E7D32' }}>{(det.confidence * 100).toFixed(0)}%</Typography>
                    </Box>
                  </Box>
                ))}
                <Box sx={{ px: 3, py: 1.75, borderTop: '1px solid #E2EAE8', backgroundColor: '#F8FAFB' }}>
                  <Typography variant="caption" color="textSecondary">{detections.length} bản ghi · phiên hiện tại</Typography>
                </Box>
              </>
            )}
          </Box>
        </Box>

        {/* ── GStreamer Pipeline Graph ── */}
        <PipelineGraphSection />

      </Container>
    </Box>
  );
}
