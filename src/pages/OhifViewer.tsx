import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { HeaderActions } from '@/components/AppShell';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { installDicomBridge } from '@/lib/dicom';

export type OhifDataset = 'pathology' | 'radiology';

const SOURCES: Record<OhifDataset, { dataSource: string; note: string; guide: string }> = {
  pathology: {
    dataSource: 'rayfin-pathology',
    note: 'Original DICOM whole-slide images (TCGA, HTAN CyCIF) and AI nucleus annotations from the NCI Imaging Data Commons',
    guide: '/guide#ohif',
  },
  radiology: {
    dataSource: 'rayfin-radiology',
    note: 'Original DICOM CT, PET, MRI, segmentations and RT structures from the NCI Imaging Data Commons',
    guide: '/guide#ohif',
  },
};

/** "About this viewer" in the top bar: what the OHIF tab shows and where it reads from. */
function AboutViewer({ note, guide }: { note: string; guide: string }) {
  const [open, setOpen] = useState(false);

  // Clicks inside the OHIF frame never reach this document, so close when the frame takes focus.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('blur', close);
    return () => window.removeEventListener('blur', close);
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="link t-muted whitespace-nowrap">About this viewer</PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="about-pop w-[340px] p-4 text-[13px]">
        <p className="font-medium" style={{ color: 'var(--ink)' }}>
          OHIF Viewer
        </p>
        <p className="t-muted mt-1.5 leading-relaxed">
          {note}, read directly from OneLake: no DICOMweb server, no conversion.
        </p>
        <Link to={guide} className="link t-muted mt-3 inline-block" onClick={() => setOpen(false)}>
          How this works
        </Link>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A full OHIF Viewer (worklist and viewer) in a same-origin frame. OHIF reads the original DICOM files straight from
 * OneLake through @rayfin/ohif-extension, asking this page for the folder and a short-lived SAS. Deep links pass
 * through as `?route=` (an OHIF path such as `microscopy`) plus OHIF's own query, e.g. `StudyInstanceUIDs`.
 */
export function OhifViewer({ dataset }: { dataset: OhifDataset }) {
  const source = SOURCES[dataset];
  const [params] = useSearchParams();
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    installDicomBridge();
    let cancelled = false;
    fetch('/ohif/rayfin-build.json', { cache: 'no-store' })
      .then((r) => !cancelled && setAvailable(r.ok))
      .catch(() => !cancelled && setAvailable(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const src = useMemo(() => {
    const q = new URLSearchParams(params);
    const route = q.get('route') ?? '';
    q.delete('route');
    q.set('datasources', source.dataSource);
    // OHIF viewer routes name the data source as a path segment (e.g. microscopy/rayfin-pathology).
    const path = route ? `${route.replace(/\/+$/, '')}/${source.dataSource}` : '';
    return `/ohif/index.html?route=${encodeURIComponent(path)}&${q.toString()}`;
    // The frame keeps its own navigation; only the first URL matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset]);

  return (
    <div className="flex h-full flex-col">
      <HeaderActions>
        <AboutViewer note={source.note} guide={source.guide} />
      </HeaderActions>
      {available === false ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <div className="max-w-md">
            <p className="font-medium">The OHIF Viewer has not been built yet.</p>
            <p className="t-muted mt-2 text-[13px]">
              Run <span className="t-mono">node ohif/build.mjs</span> (Node 24 or later), then reload this page.
            </p>
          </div>
        </div>
      ) : (
        available && (
          <iframe
            key={dataset}
            title={`OHIF Viewer · ${dataset}`}
            src={src}
            className="ohif-frame min-h-0 w-full flex-1 border-0"
            allow="fullscreen; clipboard-write"
            allowFullScreen
          />
        )
      )}
    </div>
  );
}
