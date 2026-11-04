import { useEffect, useRef, useState } from 'react';

import { lakehouseObjectUrl } from '@/lib/cases';
import type { Slide, TileAccess } from '@/lib/catalog';

const ZOOMS = [0.75, 1, 1.5, 2];

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getViewport: (o: { scale: number }) => { width: number; height: number };
    render: (o: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void>; cancel: () => void };
  }>;
  destroy: () => Promise<void>;
};

/** The scanned pathology report, rendered page by page with PDF.js beside the slide. */
export function ReportPane({
  slide,
  access,
  file,
  sourceUrl,
  onClose,
}: {
  slide: Slide;
  access: TileAccess;
  file: string;
  sourceUrl: string;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    let loaded: PdfDoc | null = null;
    void (async () => {
      try {
        objectUrl = await lakehouseObjectUrl(access, slide, file, 'application/pdf');
        if (cancelled) return;
        setUrl(objectUrl);
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        // Decoders for scanned pages (JBIG2, JPEG 2000) and font data; see pdfjsAssetsPlugin in vite.config.ts.
        const assets = `${import.meta.env.BASE_URL}pdfjs/`;
        loaded = (await pdfjs.getDocument({
          url: objectUrl,
          wasmUrl: `${assets}wasm/`,
          standardFontDataUrl: `${assets}standard_fonts/`,
          cMapUrl: `${assets}cmaps/`,
          cMapPacked: true,
        }).promise) as unknown as PdfDoc;
        if (!cancelled) setDoc(loaded);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      void loaded?.destroy();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // Reload only for a different report, not when the SAS rotates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide.id, file]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const pages = [...el.querySelectorAll<HTMLElement>('[data-page]')];
    const mid = el.scrollTop + el.clientHeight / 3;
    const current = pages.filter((p) => p.offsetTop - el.offsetTop <= mid).pop();
    if (current) setPage(Number(current.dataset.page));
  };

  const goTo = (n: number) => {
    scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`)?.scrollIntoView({ block: 'start' });
  };

  return (
    <section className="hair flex min-w-0 flex-1 flex-col border-l" aria-label="Pathology report">
      <div className="hair flex min-h-10 shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1 whitespace-nowrap border-b px-3 py-1.5 text-[12.5px]">
        <span className="font-medium">Pathology report</span>
        {doc && (
          <span className="t-faint">
            page {page} of {doc.numPages}
          </span>
        )}
        {doc && doc.numPages > 1 && (
          <span className="seg" role="group" aria-label="Page">
            <button onClick={() => goTo(Math.max(1, page - 1))} disabled={page <= 1} title="Previous page">
              ‹
            </button>
            <button onClick={() => goTo(Math.min(doc.numPages, page + 1))} disabled={page >= doc.numPages} title="Next page">
              ›
            </button>
          </span>
        )}
        <span className="seg ml-auto" role="group" aria-label="Zoom">
          <button onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])} disabled={zoom === ZOOMS[0]} title="Zoom out">
            −
          </button>
          <button onClick={() => setZoom(1)} title="Fit the page to the pane" className="tabular-nums">
            {zoom * 100}%
          </button>
          <button onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])} disabled={zoom === ZOOMS.at(-1)} title="Zoom in">
            +
          </button>
        </span>
        {url && (
          <a href={url} download={`${slide.case}-pathology-report.pdf`} className="link t-muted" title="Download the PDF">
            Download
          </a>
        )}
        <a href={sourceUrl} target="_blank" rel="noreferrer" className="link t-muted" title="The report’s record at the NCI Genomic Data Commons">
          GDC ↗
        </a>
        <button type="button" className="icon-btn" onClick={onClose} title="Close the report" aria-label="Close the report">
          ×
        </button>
      </div>
      <div ref={scroller} onScroll={onScroll} className="report-well min-h-0 flex-1 overflow-auto p-4">
        {error && <p className="t-accent text-[12.5px]">The report could not be loaded: {error}</p>}
        {!doc && !error && <p className="t-faint text-[12.5px]">Loading report…</p>}
        {doc &&
          width > 0 &&
          Array.from({ length: doc.numPages }, (_, i) => <ReportPage key={i} doc={doc} n={i + 1} width={Math.max(200, (width - 32) * zoom)} />)}
      </div>
    </section>
  );
}

function ReportPage({ doc, n, width }: { doc: PdfDoc; n: number; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let task: { promise: Promise<void>; cancel: () => void } | null = null;
    let cancelled = false;
    void doc.getPage(n).then((page) => {
      if (cancelled || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      const c = canvas.current;
      c.width = Math.round(viewport.width);
      c.height = Math.round(viewport.height);
      c.style.width = `${Math.round(viewport.width / ratio)}px`;
      c.style.height = `${Math.round(viewport.height / ratio)}px`;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      task = page.render({ canvas: c, canvasContext: ctx, viewport });
      task.promise.catch(() => undefined);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, n, width]);
  return (
    <div data-page={n} className="mx-auto mb-4 w-fit">
      <canvas ref={canvas} className="report-page block" aria-label={`Report page ${n}`} />
    </div>
  );
}
