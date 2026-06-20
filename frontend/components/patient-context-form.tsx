'use client';

/**
 * patient-context-form.tsx — Pre-session patient context (PHI) input form.
 *
 * Controlled component — parent owns state and is responsible for POSTing
 * to POST /sessions/{sessionId}/patient-context at the right time.
 * All fields are optional; returns "" for any field the doctor leaves blank.
 *
 * Usage:
 *   const [ctx, setCtx] = useState<PatientContextData>(emptyPatientContext());
 *   <PatientContextForm data={ctx} onChange={setCtx} />
 *   // On report creation: fetch(`${API_BASE}/sessions/${id}/patient-context`, ...)
 */

import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ChevronDown, ChevronUp, User } from 'lucide-react';

export interface PatientContextData {
  age: string;
  sex: string;
  indication: string;
  history: string;
  meds: string;
}

export function emptyPatientContext(): PatientContextData {
  return { age: '', sex: '', indication: '', history: '', meds: '' };
}

/** Convert form data to the JSON body expected by the backend endpoint. */
export function patientContextToBody(data: PatientContextData): Record<string, string | number | null> {
  const ageNum = data.age.trim() !== '' ? parseInt(data.age, 10) : NaN;
  return {
    age: isNaN(ageNum) ? null : ageNum,
    sex: data.sex || null,
    indication: data.indication || null,
    history: data.history || null,
    meds: data.meds || null,
  };
}

/** Returns true if the form has at least one non-empty field worth POSTing. */
export function hasPatientContext(data: PatientContextData): boolean {
  return !!(data.age || data.sex || data.indication || data.history || data.meds);
}

interface PatientContextFormProps {
  data: PatientContextData;
  onChange: (data: PatientContextData) => void;
}

export function PatientContextForm({ data, onChange }: PatientContextFormProps) {
  const [open, setOpen] = useState(true);

  const set = (field: keyof PatientContextData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange({ ...data, [field]: e.target.value });

  return (
    <Box sx={{ borderRadius: '12px', border: '1px solid #E2EAE8', backgroundColor: '#F8FAFB', mb: 1.5 }}>
      {/* Header / collapse toggle */}
      <Box
        component="button"
        onClick={() => setOpen((v) => !v)}
        sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 1,
              px: 2, py: 1.25, background: 'transparent', border: 'none',
              cursor: 'pointer', borderRadius: '12px' }}
      >
        <User size={15} color="#006064" />
        <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', color: '#006064', flex: 1, textAlign: 'left' }}>
          Thông tin bệnh nhân (tùy chọn)
        </Typography>
        {open ? <ChevronUp size={15} color="#006064" /> : <ChevronDown size={15} color="#006064" />}
      </Box>

      {open && (
        <Box sx={{ px: 2, pb: 2, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {/* Age + sex on same row */}
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4, flex: '0 0 100px' }}>
              <Typography component="label" htmlFor="pc-age" sx={labelSx}>Tuổi</Typography>
              <Box component="input" id="pc-age" type="number" min={0} max={120}
                value={data.age} onChange={set('age')}
                placeholder="VD: 54" sx={inputSx} />
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4, flex: '0 0 130px' }}>
              <Typography component="label" htmlFor="pc-sex" sx={labelSx}>Giới tính</Typography>
              <Box component="select" id="pc-sex"
                value={data.sex} onChange={set('sex')} sx={inputSx}>
                <option value="">— chọn —</option>
                <option value="Nam">Nam</option>
                <option value="Nữ">Nữ</option>
                <option value="Khác">Khác</option>
              </Box>
            </Box>
          </Box>

          {/* Indication */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
            <Typography component="label" htmlFor="pc-indication" sx={labelSx}>
              Lý do nội soi (Indication)
            </Typography>
            <Box component="input" id="pc-indication" type="text"
              value={data.indication} onChange={set('indication')}
              placeholder="VD: đau thượng vị, xuất huyết tiêu hoá..." sx={inputSx} />
          </Box>

          {/* History */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
            <Typography component="label" htmlFor="pc-history" sx={labelSx}>
              Tiền sử bệnh (History)
            </Typography>
            <Box component="textarea" id="pc-history" rows={2}
              value={data.history} onChange={set('history')}
              placeholder="VD: viêm dạ dày mãn, HP (+)..." sx={{ ...inputSx, resize: 'vertical' }} />
          </Box>

          {/* Meds */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
            <Typography component="label" htmlFor="pc-meds" sx={labelSx}>
              Thuốc đang dùng (Current meds)
            </Typography>
            <Box component="input" id="pc-meds" type="text"
              value={data.meds} onChange={set('meds')}
              placeholder="VD: omeprazole 20 mg, aspirin..." sx={inputSx} />
          </Box>
        </Box>
      )}
    </Box>
  );
}

const labelSx = { fontSize: '0.75rem', fontWeight: 600, color: '#445' } as const;
const inputSx = {
  px: 1.25, py: 0.75, borderRadius: '8px', border: '1px solid #CBD5D3',
  fontSize: '0.82rem', backgroundColor: '#fff', width: '100%',
  '&:focus': { outline: '2px solid #006064', outlineOffset: '1px' },
} as const;
