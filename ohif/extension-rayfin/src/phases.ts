/**
 * 4D playback for respiratory-gated (4D) CT, which stores each breathing phase as its own series: OHIF can step
 * through slices but not through series. When the open study has several CT series in one frame of reference with
 * the same number of slices (the phases), a "Breathing phases" control appears; Play loops the phases in the active
 * viewport at the current slice, like a 4D CT workstation. Images are the original DICOM files; nothing is merged.
 */
type DisplaySet = {
  displaySetInstanceUID: string;
  Modality?: string;
  SeriesDescription?: string;
  SeriesNumber?: number;
  FrameOfReferenceUID?: string;
  images?: Array<{ imageId?: string; FrameOfReferenceUID?: string }>;
};

const FPS = 4;
let cleanup: (() => void) | null = null;

function phaseLabel(ds: DisplaySet, i: number) {
  const m = /(\d+(?:\.\d+)?)\s*%/.exec(ds.SeriesDescription || '');
  return m ? `${Number(m[1])}%` : `phase ${i + 1}`;
}

function findPhases(displaySets: DisplaySet[]): DisplaySet[] | null {
  const groups = new Map<string, DisplaySet[]>();
  displaySets
    .filter(d => d.Modality === 'CT' && (d.images?.length ?? 0) > 10)
    .forEach(d => {
      const key = `${d.FrameOfReferenceUID || d.images?.[0]?.FrameOfReferenceUID}|${d.images!.length}`;
      groups.set(key, [...(groups.get(key) || []), d]);
    });
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  if (!best || best.length < 4) {
    return null;
  }
  const pct = (d: DisplaySet) => Number(/(\d+(?:\.\d+)?)\s*%/.exec(d.SeriesDescription || '')?.[1] ?? NaN);
  return [...best].sort((a, b) => (pct(a) - pct(b)) || ((a.SeriesNumber ?? 0) - (b.SeriesNumber ?? 0)));
}

export function installPhasePlayer(services: any) {
  const { displaySetService, viewportGridService, cornerstoneViewportService } = services;
  if (cleanup || !displaySetService || !cornerstoneViewportService) {
    return;
  }

  const bar = document.createElement('div');
  bar.className = 'rayfin-phases';
  bar.style.cssText =
    'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:50;display:none;align-items:center;gap:10px;' +
    'padding:6px 12px;background:rgba(9,12,41,0.94);border:1px solid #3a3f99;border-radius:4px;color:#e8e8f0;font-size:12.5px;';
  const play = document.createElement('button');
  play.type = 'button';
  play.style.cssText = 'background:#f26419;color:#fff;border-radius:3px;padding:3px 10px;font-weight:600;';
  const label = document.createElement('span');
  label.style.cssText = 'min-width:150px;';
  bar.append(play, label);
  document.body.append(bar);

  let phases: DisplaySet[] | null = null;
  let timer: number | undefined;
  let k = 0;

  const imageIdsOf = (d: DisplaySet) => (d.images || []).map(i => i.imageId!).filter(Boolean);
  const setIdle = () => {
    play.textContent = '▶ Play';
    label.textContent = phases ? `Breathing phases · ${phases.length} CT series` : '';
  };

  const stop = () => {
    window.clearInterval(timer);
    timer = undefined;
    setIdle();
  };

  const step = async () => {
    const viewportId = viewportGridService.getActiveViewportId();
    const vp = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    if (!phases || !vp?.setStack) {
      stop();
      return;
    }
    const index = vp.getCurrentImageIdIndex();
    k = (k + 1) % phases.length;
    await vp.setStack(imageIdsOf(phases[k]), index);
    vp.render();
    label.textContent = `Breathing phase ${phaseLabel(phases[k], k)} · ${k + 1} of ${phases.length}`;
  };

  play.onclick = () => {
    if (timer) {
      stop();
      return;
    }
    play.textContent = '❚❚ Pause';
    timer = window.setInterval(() => void step(), 1000 / FPS);
  };

  const refresh = () => {
    phases = findPhases(displaySetService.getActiveDisplaySets());
    if (!phases) {
      stop();
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    if (!timer) {
      setIdle();
    }
  };

  const subs = ['DISPLAY_SETS_ADDED', 'DISPLAY_SETS_CHANGED', 'DISPLAY_SETS_REMOVED']
    .filter(e => displaySetService.EVENTS[e])
    .map(e => displaySetService.subscribe(displaySetService.EVENTS[e], refresh));
  refresh();
  cleanup = () => {
    stop();
    subs.forEach(s => s.unsubscribe());
    bar.remove();
  };
}

export function resetPhasePlayer() {
  cleanup?.();
  cleanup = null;
}
