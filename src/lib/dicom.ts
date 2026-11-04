import type { AppFunctionsSchema } from '../../rayfin/functions/src/types';
import { LOCAL_DATA } from '@/lib/localData';
import { getRayfinClient } from '@/services/rayfin/RayfinClientService';

/** Read-only access to the DICOM folder (`Files/dicom` in the Lakehouse, `work/dicom` in local data mode). */
export type DicomAccess = AppFunctionsSchema['getDicomAccess']['output'];

/** Re-sign this long before the SAS expires; OHIF keeps reading tiles while a slide is open. */
const REFRESH_BEFORE_MS = 10 * 60_000;
let cached: DicomAccess | null = null;
let pending: Promise<DicomAccess> | null = null;

export async function getDicomAccess(): Promise<DicomAccess> {
  if (LOCAL_DATA) {
    return {
      baseUrl: `${window.location.origin}/local-data/dicom`,
      query: '',
      expiresOn: '',
      reason: 'Local files in work/dicom',
    };
  }
  if (cached && cached.expiresOn && Date.parse(cached.expiresOn) - Date.now() > REFRESH_BEFORE_MS) {
    return cached;
  }
  pending ??= getRayfinClient()
    .functions.getDicomAccess.invoke(undefined, { timeoutMs: 60_000 })
    .then((access) => {
      if (!access.baseUrl) throw new Error(`DICOM access unavailable: ${access.reason}`);
      cached = access;
      return access;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/**
 * The bridge the framed OHIF viewer reads (`window.parent.rayfinDicom`, same origin):
 * see ohif/extension-rayfin/src/access.ts.
 */
export function installDicomBridge(): void {
  (window as unknown as { rayfinDicom?: { getAccess: () => Promise<DicomAccess> } }).rayfinDicom = {
    getAccess: getDicomAccess,
  };
}
