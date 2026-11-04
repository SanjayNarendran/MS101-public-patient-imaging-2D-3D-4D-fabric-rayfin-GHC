import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { PlainWords, PlainWordsLink } from '@/components/PlainWords';
import { LakehouseImage } from '@/components/LakehouseImage';
import { DetailsPanel, ListColumn, PanelRow, PanelSection, useDetailsPanel, WorkspaceHeader } from '@/components/Panel';
import {
  SlideViewer,
  type SlideViewerHandle,
  type SyncView,
  type ViewerStatus,
  type ViewState,
} from '@/components/SlideViewer';
import { AiButtons, AiLayerControls } from '@/components/pathology/AiLayers';
import { CaseBanner } from '@/components/pathology/CaseBanner';
import { CasePanel } from '@/components/pathology/CasePanel';
import { ReportPane } from '@/components/pathology/ReportPane';
import { SlideTray } from '@/components/pathology/SlideTray';
import { markerNote, slideNote, TIPS } from '@/content/guide';
import { CASE_PREF_LABELS, useCasePrefs, useOverlayDisplay } from '@/hooks/useCasePrefs';
import { useCatalog } from '@/hooks/useCatalog';
import { caseImages, findImage, pinKey, viewSlideFor } from '@/lib/cases';
import { LOCAL_DATA } from '@/lib/localData';
import { useMaximise } from '@/hooks/useMaximise';
import { usePins } from '@/hooks/usePins';
import {
  formatBytes,
  formatGigapixels,
  formatPhysicalSize,
  type Slide,
  type SlideCatalog,
} from '@/lib/catalog';
import { OhifStudyRowText } from '@/components/OhifStudyRow';

const NICE_UM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

function ScaleBar({ umPerPixel }: { umPerPixel: number | null }) {
  if (!umPerPixel) return null;
  const um = [...NICE_UM].reverse().find((n) => n <= 110 * umPerPixel) ?? NICE_UM[0];
  return (
    <span className="flex items-center gap-2">
      <span className="scalebar inline-block" style={{ width: um / umPerPixel }} />
      <span>{um >= 1000 ? `${um / 1000} mm` : `${um} µm`}</span>
    </span>
  );
}

function markerLabel(name: string): string {
  return name.replace('Aortic smooth muscle actin', 'SMA').replace('Antigen Ki67', 'Ki-67');
}

type Channel = NonNullable<Slide['channels']>[number];

const MARKER_GROUPS: { id: NonNullable<Channel['group']>; title: string; intro?: string }[] = [
  { id: 'featured', title: 'Key markers', intro: 'Also shown as chips above the slide.' },
  { id: 'protein', title: 'More proteins' },
  {
    id: 'reference',
    title: 'Reference channels',
    intro: 'The DNA stain repeated in every imaging round, used to line the rounds up, and background-only controls.',
  },
];

function channelGroup(c: Channel): NonNullable<Channel['group']> {
  return c.group ?? 'featured';
}

function channelHint(c: Channel): string {
  const note = markerNote(c.id, c.name);
  return note ? `${note.shows} ${note.why}`.trim() : c.meaning;
}

/** Every marker channel, grouped, with what each one shows in plain words and its on-screen colour. */
function MarkerControls({
  channels,
  visible,
  onToggle,
  onSet,
  onReset,
}: {
  channels: Channel[];
  visible: Record<string, boolean>;
  onToggle: (id: string) => void;
  onSet: (ids: string[], on: boolean) => void;
  onReset: () => void;
}) {
  const shown = channels.filter((c) => visible[c.id]).length;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <span className="t-faint">{shown} shown</span>
        <button type="button" className="link t-muted" title="Switch every channel off" onClick={() => onSet(channels.map((c) => c.id), false)}>
          Hide all
        </button>
        <button type="button" className="link t-muted" title={TIPS.markersReset} onClick={onReset}>
          Reset
        </button>
        <Link to="/guide#markers" className="link t-muted ml-auto">
          What are markers?
        </Link>
      </div>
      {MARKER_GROUPS.map((g) => {
        const items = channels.filter((c) => channelGroup(c) === g.id);
        if (!items.length) return null;
        const ids = items.map((c) => c.id);
        return (
          <div key={g.id} className="mb-6 last:mb-0">
            <div className="mb-2 flex items-baseline gap-3 text-[12px]">
              <span className="font-medium" style={{ color: 'var(--ink)' }}>
                {g.title} ({items.length})
              </span>
              <button type="button" className="link t-muted ml-auto" onClick={() => onSet(ids, true)}>
                show
              </button>
              <button type="button" className="link t-muted" onClick={() => onSet(ids, false)}>
                hide
              </button>
            </div>
            {g.intro && <p className="t-faint mb-2 text-[11.5px] leading-snug">{g.intro}</p>}
            <ul className="space-y-3">
              {items.map((c) => {
                const note = markerNote(c.id, c.name);
                return (
                  <li key={c.id}>
                    <label className="flex items-center gap-2 text-[13px]">
                      <input type="checkbox" className="check" checked={!!visible[c.id]} onChange={() => onToggle(c.id)} />
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                      <span className="font-medium">{note?.name && channelGroup(c) !== 'featured' ? note.name : markerLabel(c.name)}</span>
                    </label>
                    <p className="t-faint mt-1 pl-6 text-[11.5px] leading-snug">{channelHint(c)}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}

function formatMag(mag: number): string {
  return `${mag < 10 ? mag.toFixed(1) : mag.toFixed(0)}×`;
}

function readView(params: URLSearchParams): ViewState | null {
  const x = Number(params.get('x'));
  const y = Number(params.get('y'));
  const z = Number(params.get('z'));
  return params.has('x') && Number.isFinite(x) && Number.isFinite(y) && z > 0 ? { x, y, zoom: z } : null;
}

/**
 * A slide in the list. Slides with a DICOM study lead with what the OHIF study list shows (patient, type, date),
 * so a case can be found in both tabs; the diagnosis and the slide description follow.
 */
function SlideRowText({ slide: s }: { slide: Slide }) {
  const description = `${s.organ} · ${
    s.kind === 'fluorescence' ? `${s.markersAvailable}-plex IF` : `${s.objectivePower}× H&E`
  } · ${formatGigapixels(s)}`;
  if (s.study) {
    return <OhifStudyRowText study={s.study} tab="Pathology (OHIF)" title={s.title} description={description} />;
  }
  return (
    <span className="min-w-0">
      <span className="block truncate text-[13.5px] font-medium">{s.title}</span>
      <span className="t-faint block truncate text-[11.5px]">{description}</span>
    </span>
  );
}

export function Pathology() {
  const { catalog, loading, error, reload } = useCatalog();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');

  const slides = catalog?.slides ?? [];
  const selected = slides.find((s) => s.id === params.get('slide')) ?? slides[0] ?? null;
  // Deep-link coordinates apply only to the slide they were copied from, on first open.
  const [initialView] = useState(() => readView(params));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return slides;
    return slides.filter((s) =>
      [s.title, s.organ, s.diagnosis, s.project, s.case, s.study?.patientId ?? '', s.study?.patientName ?? ''].some((v) =>
        v.toLowerCase().includes(q)
      )
    );
  }, [slides, query]);

  const select = (s: Slide) => setParams({ slide: s.id });
  const [initialImage] = useState(() => params.get('img'));

  if (!catalog) {
    return (
      <div className="flex h-full items-center justify-center">
        {error && !loading ? (
          <div className="text-center">
            <p className="font-medium">The slide catalog could not be read from the Lakehouse.</p>
            <p className="t-faint mt-2 max-w-md break-all text-[12px]">{error}</p>
            <button onClick={() => void reload()} className="btn btn-ink mt-5">
              Try again
            </button>
          </div>
        ) : (
          <p className="t-faint">Reading slide catalog from OneLake…</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <ListColumn
        label="Slides"
        query={query}
        onQuery={setQuery}
        placeholder="Search slides"
        count={`${filtered.length} of ${slides.length} slides`}
      >
        {filtered.map((s) => (
          <button key={s.id} className="list-row" aria-current={s.id === selected?.id} onClick={() => select(s)}>
            <LakehouseImage access={catalog.tileAccess} slide={s} path="thumbnail.jpg" alt="" className="list-thumb" loading="lazy" />
            <SlideRowText slide={s} />
          </button>
        ))}
        {filtered.length === 0 && <p className="t-faint px-4 py-6 text-[12.5px]">No slides match “{query}”.</p>}
      </ListColumn>

      {selected && (
        <SlideWorkspace
          key={selected.id}
          slide={selected}
          catalog={catalog}
          initialView={selected.id === params.get('slide') ? initialView : null}
          initialImage={selected.id === params.get('slide') ? initialImage : null}
          onReload={reload}
        />
      )}
    </div>
  );
}

type SidePane = 'none' | 'compare' | 'report';

function SlideWorkspace({
  slide,
  catalog,
  initialView,
  initialImage,
  onReload,
}: {
  slide: Slide;
  catalog: SlideCatalog;
  initialView: ViewState | null;
  initialImage: string | null;
  onReload: () => Promise<void>;
}) {
  const viewerRef = useRef<SlideViewerHandle>(null);
  const compareRef = useRef<SlideViewerHandle>(null);
  const [, setParams] = useSearchParams();
  const [status, setStatus] = useState<ViewerStatus | null>(null);
  const [compareStatus, setCompareStatus] = useState<ViewerStatus | null>(null);
  const maximise = useMaximise<HTMLDivElement>();
  const details = useDetailsPanel();
  const { prefs, set: setPref, reset: resetPrefs } = useCasePrefs();
  const { display: overlayDisplay, update: updateOverlay } = useOverlayDisplay();
  const info = slide.caseInfo ?? null;
  const images = caseImages(slide);
  const [imageKey, setImageKey] = useState(() => findImage(slide, initialImage)?.key ?? 'main');
  const image = findImage(slide, imageKey);
  const view = useMemo(() => viewSlideFor(slide, image), [slide, image]);
  const [side, setSide] = useState<SidePane>('none');
  const [compareKey, setCompareKey] = useState<string | null>(null);
  const compareImage = compareKey ? findImage(slide, compareKey) : null;
  const compareView = useMemo(() => (compareImage ? viewSlideFor(slide, compareImage) : null), [slide, compareImage]);
  const [linked, setLinked] = useState(true);
  const [compareAi, setCompareAi] = useState(false);
  const hiddenOverlays = useMemo(() => ({}), []);
  const [pinTitle, setPinTitle] = useState('');
  const [pinNote, setPinNote] = useState('');
  const [saving, setSaving] = useState(false);
  const { pins, addPin, removePin, currentUserId, error: pinsError } = usePins(pinKey(view));

  const selectImage = (key: string) => {
    setImageKey(key);
    setStatus(null);
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        ['x', 'y', 'z'].forEach((k) => next.delete(k));
        if (key === 'main') next.delete('img');
        else next.set('img', key);
        return next;
      },
      { replace: true }
    );
  };

  const openCompare = (key?: string) => {
    const pick =
      key ??
      compareKey ??
      images.find((i) => i.sample === 'Normal tissue')?.key ??
      images.find((i) => i.key !== imageKey)?.key ??
      imageKey;
    setCompareKey(pick);
    setSide('compare');
  };

  const hidePref = (id: keyof typeof prefs, what: string) => {
    setPref(id, false);
    toast(`${what} hidden. Turn it back on in Details › Controls.`);
  };

  const toggleOverlay = (id: string) => updateOverlay(id, { visible: !overlayDisplay[id]?.visible });

  const onMainMove = useCallback(
    (v: SyncView) => {
      if (linked && side === 'compare') compareRef.current?.syncTo(v);
    },
    [linked, side]
  );
  const onCompareMove = useCallback(
    (v: SyncView) => {
      if (linked) viewerRef.current?.syncTo(v);
    },
    [linked]
  );
  const showReport = prefs.report && !!info?.report;
  const [channels, setChannels] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((slide.channels ?? []).map((c) => [c.id, c.visible]))
  );
  const fluorescence = slide.kind === 'fluorescence' && !!slide.channels?.length;
  const toggleMarker = (id: string) => setChannels((v) => ({ ...v, [id]: !v[id] }));
  const featured = (slide.channels ?? []).filter((c) => channelGroup(c) === 'featured');
  const showAllMarkers = () => setChannels((v) => ({ ...v, ...Object.fromEntries(featured.map((c) => [c.id, true])) }));
  const setMarkers = (ids: string[], on: boolean) =>
    setChannels((v) => ({ ...v, ...Object.fromEntries(ids.map((id) => [id, on])) }));
  const resetMarkers = () => setChannels(Object.fromEntries((slide.channels ?? []).map((c) => [c.id, c.visible])));

  const viewerPins = useMemo(
    () => pins.map((p) => ({ id: p.id, title: p.title, x: Number(p.x), y: Number(p.y) })),
    [pins]
  );

  useEffect(() => {
    if (!initialView) return;
    const t = window.setTimeout(() => viewerRef.current?.flyTo(initialView), 900);
    return () => window.clearTimeout(t);
  }, [initialView]);

  const onPinClick = useCallback(
    (id: string) => {
      const pin = pins.find((p) => p.id === id);
      if (pin) viewerRef.current?.flyTo({ x: Number(pin.x), y: Number(pin.y), zoom: Number(pin.zoom) });
    },
    [pins]
  );

  const savePin = async () => {
    const view = viewerRef.current?.getView();
    if (!view || !pinTitle.trim()) return;
    setSaving(true);
    try {
      await addPin({ title: pinTitle.trim(), note: pinNote.trim(), ...view });
      setPinTitle('');
      setPinNote('');
      toast.success('Pin saved to the app database');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save pin');
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    const view = viewerRef.current?.getView();
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('slide', slide.id);
    if (imageKey !== 'main') url.searchParams.set('img', imageKey);
    if (view) {
      url.searchParams.set('x', view.x.toFixed(5));
      url.searchParams.set('y', view.y.toFixed(5));
      url.searchParams.set('z', view.zoom.toFixed(5));
    }
    await navigator.clipboard.writeText(url.toString());
    toast('Link to this view copied');
  };

  const mag = status?.magnification ?? null;
  const presets = [1.25, 5, 10, 20, 40].filter((m) => !view.objectivePower || m <= view.objectivePower);
  const physical = formatPhysicalSize(view);

  return (
    <div ref={maximise.ref} className={`flex min-w-0 flex-1 flex-col ${maximise.on ? 'workspace-max' : ''}`}>
      <WorkspaceHeader
        title={slide.title}
        meta={
          <>
            {slide.organ} · {slide.diagnosis} · <span className="t-mono">{slide.case}</span>
          </>
        }
        description={slide.blurb}
        explain={<PlainWordsLink onOpen={() => details.show('about')} />}
      />

      {info && prefs.banner && (
        <CaseBanner
          info={info}
          image={image}
          onOpenCase={() => (prefs.caseTab ? details.show('case') : setPref('caseTab', true))}
          onHide={() => hidePref('banner', 'Patient banner')}
        />
      )}

      <div className="hair flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="seg" role="group" aria-label="Magnification">
          {presets.map((m) => (
            <button
              key={m}
              onClick={() => viewerRef.current?.zoomToMagnification(m)}
              title={TIPS.magnification(m)}
              aria-pressed={mag != null && Math.abs(mag - m) / m < 0.04}
            >
              {m}×
            </button>
          ))}
        </div>
        <button
          onClick={() => (status?.touring ? viewerRef.current?.stopTour() : viewerRef.current?.startTour())}
          className={`btn ${status?.touring ? 'btn-ink' : 'btn-primary'}`}
          title={TIPS.tour}
        >
          {status?.touring ? 'Stop tour' : 'Tour'}
        </button>
        <button onClick={() => viewerRef.current?.home()} className="btn" title={TIPS.fit}>
          Fit
        </button>
        <button onClick={() => void copyLink()} className="btn" title={TIPS.copyLink}>
          Copy link
        </button>
        <button onClick={maximise.toggle} className={`btn ${maximise.on ? 'btn-ink' : ''}`} aria-pressed={maximise.on} title={maximise.on ? TIPS.exitFullScreen : TIPS.fullScreen}>
          {maximise.on ? 'Exit full screen' : 'Full screen'}
        </button>
        {!fluorescence && images.length > 0 && (
          <button
            onClick={() => (side === 'compare' ? setSide('none') : openCompare())}
            className={`btn ${side === 'compare' ? 'btn-ink' : ''}`}
            aria-pressed={side === 'compare'}
            title={TIPS.compare}
          >
            Compare
          </button>
        )}
        {showReport && (
          <button
            onClick={() => setSide(side === 'report' ? 'none' : 'report')}
            className={`btn ${side === 'report' ? 'btn-ink' : ''}`}
            aria-pressed={side === 'report'}
            title={TIPS.report}
          >
            Report
          </button>
        )}
        {prefs.aiButtons && view.overlays.length > 0 && (
          <span className="ml-auto">
            <AiButtons overlays={view.overlays} display={overlayDisplay} onToggle={toggleOverlay} onMore={() => details.show('controls')} />
          </span>
        )}
      </div>

      {fluorescence && (
        <div className="hair flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
          <span className="t-faint mr-1 text-[12px]">Key markers</span>
          {featured.map((c) => (
            <button
              key={c.id}
              className="marker-chip"
              aria-pressed={channels[c.id]}
              title={channelHint(c)}
              onClick={() => toggleMarker(c.id)}
            >
              <span className="swatch" style={{ background: c.color, color: c.color }} />
              {markerLabel(c.name)}
            </button>
          ))}
          <button className="link t-muted ml-2 text-[12px]" title={TIPS.markersAll} onClick={showAllMarkers}>
            all
          </button>
          <button className="link t-muted text-[12px]" title={TIPS.markersReset} onClick={resetMarkers}>
            reset
          </button>
          {slide.channels!.length > featured.length && (
            <button
              type="button"
              className="link t-muted ml-auto text-[12px]"
              onClick={() => details.show('controls')}
              title="All marker channels, with what each one shows"
            >
              All {slide.channels!.length} channels ›
            </button>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              {side === 'compare' && (
                <div className="pane-head hair flex h-9 shrink-0 items-center gap-2 border-b px-3 text-[12px]">
                  <span className="font-medium">{image?.label ?? slide.title}</span>
                  <span className="t-faint">{mag != null ? formatMag(mag) : ''}</span>
                </div>
              )}
              <div className="relative min-h-0 flex-1">
                <SlideViewer
                  key={view.imageKey}
                  channelVisibility={fluorescence ? channels : undefined}
                  overlayDisplay={overlayDisplay}
                  ref={viewerRef}
                  slide={view}
                  access={catalog.tileAccess}
                  pins={viewerPins}
                  onStatus={setStatus}
                  onPinClick={onPinClick}
                  onAccessExpired={() => void onReload()}
                  onViewChange={side === 'compare' && linked ? onMainMove : undefined}
                />
              </div>
            </div>
            {side === 'compare' && compareView && (
              <section className="hair flex min-w-0 flex-1 flex-col border-l" aria-label="Comparison slide">
                <div className="pane-head hair flex h-9 shrink-0 items-center gap-3 border-b px-3 text-[12px]">
                  <select
                    className="field h-7 max-w-[220px] py-0 text-[12px]"
                    value={compareView.imageKey}
                    onChange={(e) => setCompareKey(e.target.value)}
                    aria-label="Slide on the right"
                  >
                    {images.map((i) => (
                      <option key={i.key} value={i.key}>
                        {i.label}
                      </option>
                    ))}
                  </select>
                  <span className="t-faint">{compareStatus?.magnification != null ? formatMag(compareStatus.magnification) : ''}</span>
                  {compareView.overlays.length > 0 && (
                    <label className="flex items-center gap-1.5 whitespace-nowrap" title="Draw this slide’s AI layers on the right as well">
                      <input type="checkbox" className="check" checked={compareAi} onChange={() => setCompareAi(!compareAi)} />
                      AI layers
                    </label>
                  )}
                  <label className="flex items-center gap-1.5 whitespace-nowrap" title={TIPS.linkViews}>
                    <input type="checkbox" className="check" checked={linked} onChange={() => setLinked(!linked)} />
                    Link views
                  </label>
                  <button type="button" className="icon-btn ml-auto h-7 w-7" onClick={() => setSide('none')} title="Close the comparison" aria-label="Close the comparison">
                    ×
                  </button>
                </div>
                <div className="relative min-h-0 flex-1">
                  <SlideViewer
                    key={compareView.imageKey}
                    ref={compareRef}
                    slide={compareView}
                    access={catalog.tileAccess}
                    pins={[]}
                    overlayDisplay={compareAi ? overlayDisplay : hiddenOverlays}
                    onStatus={setCompareStatus}
                    onAccessExpired={() => void onReload()}
                    onViewChange={linked ? onCompareMove : undefined}
                  />
                </div>
              </section>
            )}
            {side === 'report' && info?.report && showReport && (
              <ReportPane
                slide={slide}
                access={catalog.tileAccess}
                file={info.report.file}
                sourceUrl={info.report.sourceUrl}
                onClose={() => setSide('none')}
              />
            )}
          </div>
          {info && prefs.tray && images.length > 0 && (
            <SlideTray
              slide={slide}
              access={catalog.tileAccess}
              images={images}
              current={view.imageKey}
              compare={side === 'compare' ? compareView?.imageKey ?? null : null}
              onSelect={selectImage}
              onCompare={(key) => openCompare(key)}
              onHide={() => hidePref('tray', 'Filmstrip')}
            />
          )}
          <div className="statusbar flex h-9 shrink-0 items-center gap-6 overflow-hidden whitespace-nowrap px-4 text-[12.5px]">
            <span className="w-14 text-[14px] font-semibold">{mag != null ? formatMag(mag) : '…'}</span>
            <ScaleBar umPerPixel={status?.umPerPixel ?? null} />
            <span className="t-muted">{(status?.tilesLoaded ?? 0).toLocaleString()} tiles loaded</span>
            {status?.firstTileMs != null && <span className="t-faint">first tile {status.firstTileMs} ms</span>}
            {!!status?.tilesFailed && <span className="t-accent">{status.tilesFailed} failed</span>}
            <span className="t-faint ml-auto hidden lg:inline">Scroll to zoom · drag to pan · double-click to zoom in</span>
          </div>
        </div>

        <DetailsPanel
          panel={details}
          about={
            <>
                <PanelSection title="In plain words">
                  <PlainWords note={slideNote(slide.id, slide.kind)} guideHref={fluorescence ? '/guide#markers' : '/guide#pathology-controls'} />
                </PanelSection>

                <PanelSection title="Specimen">
                  <dl>
                    <PanelRow term="Project">{slide.project}</PanelRow>
                    <PanelRow term="Case">
                      <span className="t-mono">{slide.case}</span>
                    </PanelRow>
                    {image && (
                      <PanelRow term="Slide">
                        {image.label}
                        <span className="t-faint t-mono block text-[11px]">{image.barcode}</span>
                      </PanelRow>
                    )}
                    <PanelRow term="Scanner">
                      {slide.vendor ? `${slide.vendor[0].toUpperCase()}${slide.vendor.slice(1)}, ` : ''}
                      {view.objectivePower}× objective
                    </PanelRow>
                    <PanelRow term="Resolution">{view.mpp ? `${view.mpp.toFixed(3)} µm per pixel` : 'not recorded'}</PanelRow>
                    <PanelRow term="Pixels">
                      {view.width.toLocaleString()} × {view.height.toLocaleString()}
                    </PanelRow>
                    <PanelRow term="Area">{physical ?? 'not recorded'}</PanelRow>
                    <PanelRow term="Pyramid">
                      {view.levels} levels, {view.tileCount.toLocaleString()} tiles
                    </PanelRow>
                    <PanelRow term="Source file">
                      {fluorescence ? `${slide.sourceFile}, ${formatBytes(slide.rawSizeBytes)}` : `${formatBytes(view.rawSizeBytes)} Aperio SVS`}
                    </PanelRow>
                    {slide.license && <PanelRow term="Licence">{slide.license}</PanelRow>}
                  </dl>
                </PanelSection>

                <PanelSection title="Storage">
                  <div className="text-[12.5px]">
                    {catalog.lakehouse.workspaceName}/<span className="font-semibold">{catalog.lakehouse.lakehouseName}</span>
                  </div>
                  <ul className="t-muted t-mono mt-2 space-y-1 break-all text-[11.5px]">
                    {view.imageKey === 'main' ? (
                      <>
                        <li>Files/{slide.raw}</li>
                        <li>Files/{fluorescence ? `${slide.tiles}/<marker>/slide.dzi` : slide.dzi}</li>
                        <li>Files/{slide.tiles}/</li>
                      </>
                    ) : (
                      <>
                        <li>Files/slides/{slide.id}/{view.prefix}slide.dzi</li>
                        <li>Files/slides/{slide.id}/{view.prefix}slide_files/</li>
                      </>
                    )}
                    {view.overlays.map((o) => (
                      <li key={o.id}>
                        Files/slides/{slide.id}/{view.prefix}
                        {o.kind === 'tiled' ? o.prefix : o.file}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex gap-4 text-[12.5px]">
                    {catalog.lakehouse.portalUrl && (
                      <a href={catalog.lakehouse.portalUrl} target="_blank" rel="noreferrer" className="link">
                        Open in Fabric ↗
                      </a>
                    )}
                    <a href={view.sourceUrl} target="_blank" rel="noreferrer" className="link">
                      {view.sourceUrl.includes('gdc.cancer.gov') ? 'GDC record ↗' : 'Source ↗'}
                    </a>
                  </div>
                </PanelSection>
            </>
          }
          caseInfo={
            info && prefs.caseTab ? (
              <CasePanel
                info={info}
                image={image}
                reportOpen={side === 'report'}
                onOpenReport={showReport ? () => setSide('report') : null}
              />
            ) : undefined
          }
          controls={
            <>
              {info && (
                <PanelSection title="AI layers" aside={<Link to="/guide#ai-layers" className="link">About AI layers</Link>}>
                  <AiLayerControls overlays={view.overlays} display={overlayDisplay} onUpdate={updateOverlay} />
                </PanelSection>
              )}

              {info && (
                <PanelSection
                  title="Show on screen"
                  aside={
                    <button type="button" className="link" onClick={resetPrefs}>
                      Show all
                    </button>
                  }
                >
                  <ul className="space-y-2.5">
                    {CASE_PREF_LABELS.map((pref) => (
                      <li key={pref.id}>
                        <label className="flex items-center gap-2 text-[13px]">
                          <input type="checkbox" className="check" checked={prefs[pref.id]} onChange={() => setPref(pref.id, !prefs[pref.id])} />
                          <span className="font-medium">{pref.label}</span>
                        </label>
                        <p className="t-faint mt-0.5 pl-6 text-[11.5px] leading-snug">{pref.hint}</p>
                      </li>
                    ))}
                  </ul>
                </PanelSection>
              )}

              {fluorescence && (
                <PanelSection title={`Marker channels (${slide.channels!.length})`}>
                  <MarkerControls
                    channels={slide.channels!}
                    visible={channels}
                    onToggle={toggleMarker}
                    onSet={setMarkers}
                    onReset={resetMarkers}
                  />
                </PanelSection>
              )}

                <PanelSection title={`Pins (${pins.length})`} aside={<span>{LOCAL_DATA ? 'saved in this browser' : 'shared with all viewers'}</span>}>
                  {pinsError && <p className="t-accent text-[12px]">{pinsError}</p>}
                  {pins.length === 0 && !pinsError && (
                    <p className="t-faint text-[12.5px]">No pins yet. Zoom to a region and give it a name.</p>
                  )}
                  <ul>
                    {pins.map((pin) => (
                      <li key={pin.id} className="hair flex items-start gap-3 border-b py-2.5 last:border-b-0">
                        <span className="mt-[6px] h-2 w-2 shrink-0 rounded-full" style={{ background: 'var(--accent)' }} />
                        <button className="min-w-0 flex-1 text-left" onClick={() => onPinClick(pin.id)}>
                          <span className="block truncate text-[13px] font-medium hover:underline">{pin.title}</span>
                          {pin.note && <span className="t-muted block text-[12px]">{pin.note}</span>}
                          <span className="t-faint block text-[11.5px]">
                            {view.objectivePower ? `${formatMag(view.objectivePower * Number(pin.zoom))} · ` : ''}
                            {pin.authorName}
                          </span>
                        </button>
                        {pin.createdBy === currentUserId && (
                          <button
                            onClick={() => void removePin(pin.id).catch((e) => toast.error(String(e)))}
                            className="link t-faint text-[11.5px]"
                          >
                            remove
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 space-y-2">
                    <input
                      value={pinTitle}
                      onChange={(e) => setPinTitle(e.target.value.slice(0, 120))}
                      placeholder="Name this view"
                      aria-label="Pin name"
                      className="field"
                      onKeyDown={(e) => e.key === 'Enter' && void savePin()}
                    />
                    <input
                      value={pinNote}
                      onChange={(e) => setPinNote(e.target.value.slice(0, 500))}
                      placeholder="Note (optional)"
                      aria-label="Pin note"
                      className="field"
                    />
                    <button
                      onClick={() => void savePin()}
                      disabled={saving || !pinTitle.trim()}
                      className="btn btn-ink w-full justify-center"
                    >
                      {saving ? 'Saving…' : 'Pin this view'}
                    </button>
                  </div>
                </PanelSection>

                <PanelSection title="Moving around">
                  <p className="t-muted text-[12.5px] leading-relaxed">
                    Scroll to zoom, drag to pan, double-click to zoom in. The magnification buttons jump to what a
                    microscope lens of that power would show; Tour flies through the most cell-dense areas.
                  </p>
                </PanelSection>
            </>
          }
        />
      </div>
    </div>
  );
}
