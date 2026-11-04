/**
 * Fluorescence (multiplexed immunofluorescence) support for OHIF's slide viewer, which shows a channel list but no
 * channel controls: when a fluorescence slide opens, switch on its key markers with the same colours, contrast
 * windows and gamma as the Rayfin tile viewer (series/<uid>/display.json), and add a compact channel picker over the
 * slide. The channel layers are also made to mix like the tile viewer (see matchTileViewerRendering).
 */
type Channel = { name: string; color: number[]; visible: boolean; limitValues: number[]; group?: string; order?: number };
type Display = { gamma?: number; channels: Record<string, Channel> };

type OlLayer = {
  styleVariables_?: Record<string, number>;
  setStyle?: (style: Record<string, unknown>) => void;
  on: (type: string, listener: (event: { context: WebGLRenderingContext }) => void) => void;
};
type OlLayers = {
  getArray: () => OlLayer[];
  on: (type: 'add', listener: (event: { element: OlLayer }) => void) => void;
};
type OlMap = {
  getLayers: () => OlLayers;
  getControls: () => { getArray: () => Array<{ getOverviewMap?: () => OlMap }> };
};

type DmvViewer = {
  getAllOpticalPaths: () => Array<{ identifier: string; description?: string }>;
  isOpticalPathActive: (id: string) => boolean;
  activateOpticalPath: (id: string) => void;
  deactivateOpticalPath: (id: string) => void;
  showOpticalPath: (id: string) => void;
  hideOpticalPath: (id: string) => void;
  setOpticalPathStyle: (id: string, style: Record<string, unknown>) => void;
  getMap?: () => OlMap;
};

type GetDisplay = (StudyInstanceUID: string, SeriesInstanceUID: string) => Promise<Display | null>;

const PATCHED = Symbol('rayfinFluorescence');

export function installFluorescenceSupport(microscopyService: any, getDisplay: () => GetDisplay | undefined) {
  if (!microscopyService || microscopyService[PATCHED]) {
    return;
  }
  microscopyService[PATCHED] = true;
  const addViewer = microscopyService.addViewer.bind(microscopyService);
  microscopyService.addViewer = (viewer: DmvViewer, viewportId: string, container: HTMLElement, StudyInstanceUID: string, SeriesInstanceUID: string) => {
    const managed = addViewer(viewer, viewportId, container, StudyInstanceUID, SeriesInstanceUID);
    const fetchDisplay = getDisplay();
    fetchDisplay?.(StudyInstanceUID, SeriesInstanceUID)
      .then(display => display && applyDisplay(viewer, container, display))
      .catch(error => console.warn('Fluorescence display presets unavailable', error));
    return managed;
  };
}

function hex(rgb: number[]) {
  return `rgb(${rgb.join(',')})`;
}

/**
 * dicom-microscopy-viewer maps each channel linearly from black to its colour and mixes channels with
 * blendFunc(SRC_COLOR, ONE), which squares every colour before adding it (gold turns orange, mid-tones darken).
 * The Rayfin tile viewer raises the windowed intensity to `gamma` and adds channels like light. Do the same here:
 * the same style variables (DMV keeps updating them), a gamma curve, and plain additive blending. DMV adds a
 * channel's layers to the map (and the overview map) only when the channel is switched on, so layers are patched
 * as they are added.
 */
function matchTileViewerRendering(viewer: DmvViewer, gamma: number) {
  const map = viewer.getMap?.();
  if (!map) {
    return;
  }
  const windowed = [
    'clamp',
    ['+', ['/', ['-', ['band', 1], ['var', 'windowCenter']], ['var', 'windowWidth']], 0.5],
    0,
    1,
  ];
  const color = [
    'interpolate',
    ['linear'],
    ['^', windowed, ['var', 'gamma']],
    0,
    [0, 0, 0, 1],
    1,
    ['color', ['var', 'red'], ['var', 'green'], ['var', 'blue'], 1],
  ];
  const patched = new WeakSet<OlLayer>();
  const patch = (layer: OlLayer) => {
    const vars = layer.styleVariables_;
    if (patched.has(layer) || !vars || !('windowCenter' in vars) || !('red' in vars)) {
      return;
    }
    patched.add(layer);
    layer.setStyle?.({ color, variables: { ...vars, gamma } });
    // Registered after DMV's own precompose listener, so this blend function is the one in effect.
    layer.on('precompose', event => {
      const gl = event.context;
      gl.blendFunc(gl.ONE, gl.ONE);
    });
  };
  const watch = (m: OlMap) => {
    const layers = m.getLayers();
    layers.getArray().forEach(patch);
    layers.on('add', event => patch(event.element));
  };
  watch(map);
  const overview = map.getControls().getArray().find(c => typeof c.getOverviewMap === 'function')?.getOverviewMap?.();
  if (overview) {
    watch(overview);
  }
}

function applyDisplay(viewer: DmvViewer, container: HTMLElement, display: Display) {
  matchTileViewerRendering(viewer, display.gamma ?? 1);
  const paths = viewer.getAllOpticalPaths();
  const on = new Set<string>();
  paths.forEach(p => {
    const ch = display.channels[p.identifier];
    if (!ch) {
      return;
    }
    viewer.setOpticalPathStyle(p.identifier, { color: ch.color, limitValues: ch.limitValues, opacity: 1 });
    if (ch.visible) {
      viewer.activateOpticalPath(p.identifier);
      viewer.showOpticalPath(p.identifier);
      on.add(p.identifier);
    }
  });
  const ids = paths
    .map(p => p.identifier)
    .filter(id => display.channels[id])
    .sort((a, b) => (display.channels[a].order ?? 999) - (display.channels[b].order ?? 999));
  addPicker(viewer, container, ids, display, on);
}

function addPicker(viewer: DmvViewer, container: HTMLElement, ids: string[], display: Display, on: Set<string>) {
  container.querySelector('.rayfin-channels')?.remove();
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }
  const box = document.createElement('div');
  box.className = 'rayfin-channels';
  box.style.cssText =
    'position:absolute;top:8px;right:8px;z-index:20;max-height:calc(100% - 16px);display:flex;flex-direction:column;' +
    'background:rgba(9,12,41,0.92);border:1px solid #3a3f99;border-radius:4px;color:#e8e8f0;font-size:12px;min-width:210px;';
  const head = document.createElement('button');
  head.type = 'button';
  head.style.cssText = 'text-align:left;padding:6px 10px;font-weight:600;color:#f26419;';
  const list = document.createElement('div');
  list.style.cssText = 'overflow:auto;min-height:0;padding:2px 6px 8px;display:none;';
  const label = () => `Channels · ${on.size} of ${ids.length} on  ${list.style.display === 'none' ? '▸' : '▾'}`;
  head.onclick = () => {
    list.style.display = list.style.display === 'none' ? 'block' : 'none';
    head.textContent = label();
  };
  const GROUPS: Record<string, string> = { featured: 'Key markers', protein: 'More proteins', reference: 'Reference channels' };
  let lastGroup = '';
  ids.forEach(id => {
    const ch = display.channels[id];
    if (ch.group && ch.group !== lastGroup) {
      lastGroup = ch.group;
      const h = document.createElement('div');
      h.textContent = GROUPS[ch.group] ?? ch.group;
      h.style.cssText = 'padding:8px 4px 2px;color:#9aa0c8;font-size:11px;';
      list.append(h);
    }
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 4px;cursor:pointer;white-space:nowrap;';
    const box2 = document.createElement('input');
    box2.type = 'checkbox';
    box2.checked = on.has(id);
    box2.style.accentColor = '#f26419';
    const sw = document.createElement('span');
    sw.style.cssText = `width:10px;height:10px;border-radius:50%;background:${hex(ch.color)};flex:none;`;
    const name = document.createElement('span');
    name.textContent = ch.name;
    box2.onchange = () => {
      if (box2.checked) {
        viewer.activateOpticalPath(id);
        viewer.showOpticalPath(id);
        on.add(id);
      } else {
        viewer.hideOpticalPath(id);
        viewer.deactivateOpticalPath(id);
        on.delete(id);
      }
      head.textContent = label();
    };
    row.append(box2, sw, name);
    list.append(row);
  });
  head.textContent = label();
  box.append(head, list);
  container.append(box);
}
