'use client';

/**
 * disclaimer.tsx — clinical-safety boilerplate around AI-generated reports.
 *
 * Decision 4C (locked): show a banner at the top of any AI-report surface
 * AND a footer line at the bottom. Banner carries the legal/clinical weight
 * ("not a substitute for physician judgment"); footer carries the technical
 * provenance ("Powered by MedGemma").
 *
 * Wording is intentionally conservative — nội soi tổn thương dạ dày-thực
 * quản is high-stakes; under-warning is worse than over-warning.
 */

import { AlertTriangle } from 'lucide-react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

export function DisclaimerBanner() {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'flex-start', gap: 1,
      px: 1.5, py: 1, mb: 1.25,
      borderRadius: '8px',
      backgroundColor: 'rgba(237,108,2,0.08)',
      border: '1px solid rgba(237,108,2,0.25)',
    }}>
      <AlertTriangle size={14} color="#ED6C02" style={{ flexShrink: 0, marginTop: 2 }} />
      <Typography sx={{ fontSize: '0.74rem', color: '#8A4500', lineHeight: 1.5 }}>
        Báo cáo do AI sinh ra mang tính <strong>gợi ý hỗ trợ</strong>, không thay thế
        đánh giá của bác sĩ chuyên khoa. Mọi quyết định lâm sàng (sinh thiết, điều trị)
        phải do bác sĩ phê duyệt.
      </Typography>
    </Box>
  );
}

export function DisclaimerFooter() {
  return (
    <Typography sx={{
      fontSize: '0.66rem',
      color: 'text.disabled',
      textAlign: 'center',
      mt: 1.5,
      lineHeight: 1.4,
    }}>
      Powered by MedGemma · AI confidence ≠ medical certainty
    </Typography>
  );
}
