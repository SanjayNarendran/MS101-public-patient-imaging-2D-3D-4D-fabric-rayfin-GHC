import { useCallback, useState } from 'react';

import type { OverlayDisplay } from '@/components/SlideViewer';

/** What the Pathology workspace shows around the slide; each can be switched off in Details › Controls. */
export interface CasePrefs {
  /** Patient banner above the toolbar. */
  banner: boolean;
  /** Filmstrip of the patient's other slides under the viewer. */
  tray: boolean;
  /** AI layer buttons in the toolbar. */
  aiButtons: boolean;
  /** Report button and the report beside the slide. */
  report: boolean;
  /** Case tab in the details panel. */
  caseTab: boolean;
}

export const CASE_PREF_LABELS: { id: keyof CasePrefs; label: string; hint: string }[] = [
  { id: 'banner', label: 'Patient banner', hint: 'Case, age, diagnosis, stage and key gene changes above the slide' },
  { id: 'tray', label: 'Slides from this patient', hint: 'The filmstrip of the patient’s other slides under the viewer' },
  { id: 'aiButtons', label: 'AI layer buttons', hint: 'Nuclei and Immune cells buttons in the toolbar (the layers stay in this tab)' },
  { id: 'report', label: 'Pathology report', hint: 'The Report button, and the report beside the slide' },
  { id: 'caseTab', label: 'Case tab', hint: 'Patient record, tumour genes and data sources in this panel' },
];

const DEFAULT_PREFS: CasePrefs = { banner: true, tray: true, aiButtons: true, report: true, caseTab: true };
const PREFS_KEY = 'atlas.casePrefs';

function readJson<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

export function useCasePrefs() {
  const [prefs, setPrefs] = useState<CasePrefs>(() => readJson(PREFS_KEY, DEFAULT_PREFS));
  const set = useCallback((id: keyof CasePrefs, on: boolean) => {
    setPrefs((p) => {
      const next = { ...p, [id]: on };
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  const reset = useCallback(() => {
    localStorage.removeItem(PREFS_KEY);
    setPrefs(DEFAULT_PREFS);
  }, []);
  return { prefs, set, reset };
}

const OVERLAY_KEY = 'atlas.overlays';
const DEFAULT_OVERLAYS: Record<string, OverlayDisplay> = {
  nuclei: { visible: false, opacity: 0.9 },
  til: { visible: false, opacity: 0.6 },
};

/** AI layer visibility and opacity, remembered across slides so a layer stays on while browsing. */
export function useOverlayDisplay() {
  const [display, setDisplay] = useState<Record<string, OverlayDisplay>>(() => readJson(OVERLAY_KEY, DEFAULT_OVERLAYS));
  const update = useCallback((id: string, patch: Partial<OverlayDisplay>) => {
    setDisplay((d) => {
      const next = { ...d, [id]: { ...(d[id] ?? { visible: false, opacity: 0.8 }), ...patch } };
      localStorage.setItem(OVERLAY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  return { display, update };
}
