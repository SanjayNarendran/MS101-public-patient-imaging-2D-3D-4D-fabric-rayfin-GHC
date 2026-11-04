/** @type {AppTypes.Config} */
// OHIF app config for Rayfin Imaging (copied to app-config.js by ohif/build.mjs).
// Two read-only data sources read original DICOM files from the Fabric Lakehouse (OneLake) through
// @rayfin/ohif-extension: `rayfin-pathology` for the Pathology (OHIF) tab and `rayfin-radiology` for 3D/4D (OHIF).

// The Rayfin app frames OHIF at /ohif/index.html?route=<path>&<query>, so static hosting never needs fallback routes
// for OHIF's client-side paths. Turn that into the real route before OHIF's router starts.
(function () {
  var base = window.PUBLIC_URL || '/ohif/';
  if (window.location.pathname === base + 'index.html') {
    var params = new URLSearchParams(window.location.search);
    var route = params.get('route') || '';
    params.delete('route');
    var query = params.toString();
    window.history.replaceState(null, '', base + route + (query ? '?' + query : ''));
  }
})();

window.config = {
  name: 'config/rayfin.js',
  routerBasename: '/ohif',
  extensions: [],
  modes: [],
  // "Crop 3D" (@rayfin/ohif-extension, crop3d.ts) goes after 3D Rotate in the main toolbar of the Cornerstone modes.
  customizationService: {
    global: {
      'cornerstone.toolbarButtons': {
        $push: [
          {
            id: 'Crop3D',
            uiType: 'ohif.toolButton',
            props: {
              icon: 'rayfin-crop-3d',
              label: 'Crop 3D',
              tooltip: 'Crop 3D: drag the handles in the 3D view, or the box edges on the slices',
              commands: 'rayfinToggleCrop3D',
              evaluate: 'evaluate.rayfin.crop3d',
            },
          },
        ],
      },
      'cornerstone.toolbarSections': {
        primary: { $splice: [[4, 0, 'Crop3D']] },
      },
    },
  },
  showStudyList: true,
  maxNumberOfWebWorkers: 3,
  showWarningMessageForCrossOrigin: false,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  experimentalStudyBrowserSort: false,
  strictZSpacingForVolumeViewport: true,
  groupEnabledModesFirst: true,
  allowMultiSelectExport: false,
  // OneLake serves HTTP/2, so many small requests can run in parallel.
  maxNumRequests: {
    interaction: 100,
    thumbnail: 8,
    prefetch: 30,
  },
  showErrorDetails: 'always',
  investigationalUseDialog: {
    option: 'never',
  },
  whiteLabeling: {
    createLogoComponentFn: function (React) {
      return React.createElement(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            color: 'white',
            fontWeight: 600,
            fontSize: '15px',
            letterSpacing: '0.01em',
            whiteSpace: 'nowrap',
          },
        },
        React.createElement('span', {
          style: { width: '10px', height: '10px', background: '#f26419', display: 'inline-block' },
        }),
        'Rayfin Imaging · DICOM'
      );
    },
  },
  // Slides open in Microscopy mode, which shows fluorescence channels and nucleus annotations; the Cornerstone modes
  // would show neither, so the worklist only offers Microscopy for studies with slides.
  modesConfiguration: {
    '@ohif/mode-longitudinal': { excludedModalities: { $set: ['SM'] } },
    '@ohif/mode-basic': { excludedModalities: { $set: ['SM'] } },
    '@ohif/mode-segmentation': { excludedModalities: { $set: ['SM'] } },
  },
  defaultDataSourceName: 'rayfin-radiology',
  dataSources: [
    {
      namespace: '@rayfin/ohif-extension.dataSourcesModule.rayfin',
      sourceName: 'rayfin-pathology',
      configuration: {
        friendlyName: 'Fabric Lakehouse · DICOM pathology',
        dataset: 'pathology',
      },
    },
    {
      namespace: '@rayfin/ohif-extension.dataSourcesModule.rayfin',
      sourceName: 'rayfin-radiology',
      configuration: {
        friendlyName: 'Fabric Lakehouse · DICOM radiology',
        dataset: 'radiology',
      },
    },
  ],
  httpErrorHandler: error => {
    console.warn('DICOM request failed', error?.status);
  },
};
