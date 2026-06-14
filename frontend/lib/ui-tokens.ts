/**
 * ui-tokens.ts — hardcoded fallback copies of the most-used design tokens.
 *
 * Mirror of tokens.css. Used directly in inline styles on the pages that the
 * new-theme prototype was ported from (Dashboard, Docs), where var(--token)
 * resolution can briefly fail (Tailwind v4's PostCSS pipeline sometimes drops
 * nested @import). Previously this object was copy-pasted into both page.tsx
 * and docs/page.tsx — now there is one source.
 */

export const HERO_GRADIENT =
  'linear-gradient(135deg, #003A3D 0%, #006064 45%, #00838F 100%)';

export const C = {
  // teal brand
  teal700: '#004D50', teal600: '#006064', teal100: '#C6E0E1', teal50: '#E6F2F2',
  // neutrals
  neutral800: '#222B2A', neutral700: '#36403F', neutral600: '#4F5C5B',
  neutral500: '#6E7C7B', neutral400: '#9BA9A8', neutral300: '#C9D4D3',
  neutral200: '#E2EAE9', neutral100: '#EEF2F2', neutral50: '#F7FAFA',
  // surfaces / borders
  borderSubtle: '#E2EAE9', bgSubtle: '#F1F5F5', bgPaper: '#FFFFFF', bgApp: '#F7FAFA',
  shadowSm: '0 1px 2px rgba(13,27,42,0.04), 0 1px 1px rgba(13,27,42,0.03)',
  // severity (lesion groups)
  sevCancer: '#C44E52', sevInflam: '#DD8452', sevUlcer: '#55A868',
  // workflow status
  stAnalyzed: '#0277BD', stConfirmed: '#059669', stProcessing: '#6366F1',
  stDetected: '#D97706', stIgnored: '#9AA5B1',
} as const;
