/**
 * recording-upload-store.ts — tiny shared store for the in-flight live-recording
 * upload (name + %).
 *
 * The upload starts in BrowserCaptureLive (live workspace view) but the progress
 * must be visible on the recordings list — a different view/modal. A dedicated
 * external store (not AnalysisContext) keeps the frequent % ticks out of the big
 * context, so only the few components that subscribe re-render.
 */

import { useSyncExternalStore } from 'react';

export interface RecordingUploadState {
  active: boolean;                              // true while a row should be shown
  name: string;                                 // recording filename
  pct: number;                                  // 0–100
  status: 'idle' | 'uploading' | 'done' | 'error';
}

let _state: RecordingUploadState = { active: false, name: '', pct: 0, status: 'idle' };
const _listeners = new Set<() => void>();
let _clearTimer: ReturnType<typeof setTimeout> | null = null;

function _emit() { for (const l of _listeners) l(); }
function _set(next: RecordingUploadState) { _state = next; _emit(); }

export function startRecordingUpload(name: string): void {
  if (_clearTimer) { clearTimeout(_clearTimer); _clearTimer = null; }
  _set({ active: true, name, pct: 0, status: 'uploading' });
}

export function setRecordingUploadProgress(pct: number): void {
  if (!_state.active) return;
  _set({ ..._state, pct: Math.max(0, Math.min(100, Math.round(pct))) });
}

/** Mark the upload finished; the row lingers briefly then auto-clears. */
export function finishRecordingUpload(ok: boolean): void {
  _set({ ..._state, active: true, pct: ok ? 100 : _state.pct, status: ok ? 'done' : 'error' });
  if (_clearTimer) clearTimeout(_clearTimer);
  _clearTimer = setTimeout(() => _set({ active: false, name: '', pct: 0, status: 'idle' }),
    ok ? 3000 : 6000);
}

function _subscribe(cb: () => void): () => void {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}
function _snapshot(): RecordingUploadState { return _state; }

/** Subscribe a component to the recording-upload progress. */
export function useRecordingUpload(): RecordingUploadState {
  return useSyncExternalStore(_subscribe, _snapshot, _snapshot);
}
