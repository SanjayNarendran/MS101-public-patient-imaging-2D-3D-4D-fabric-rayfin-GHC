import {
  DataLakeSASPermissions,
  DataLakeServiceClient,
  SASProtocol,
  generateDataLakeSASQueryParameters,
} from '@azure/storage-file-datalake';
import {
  AudienceType,
  UserDataFunctions,
  type RayfinContext,
} from '@microsoft/fabric-user-data-functions';

/*
 * Fabric workspace and Lakehouse the app reads its images from. The block between the markers is
 * rewritten by `python scripts/setup_fabric.py --workspace <name>`; do not edit it by hand.
 */
// <lakehouse-config>
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000000';
const WORKSPACE_NAME = 'not-configured';
const LAKEHOUSE_ID = '00000000-0000-0000-0000-000000000000';
const LAKEHOUSE_NAME = 'not-configured';
// </lakehouse-config>

if (/^0{8}-/.test(WORKSPACE_ID) || /^0{8}-/.test(LAKEHOUSE_ID)) {
  console.error('Lakehouse not configured: run `python scripts/setup_fabric.py --workspace <name>` and redeploy.');
}

const ONELAKE_DFS = 'https://onelake.dfs.fabric.microsoft.com';
const ONELAKE_BLOB = 'https://onelake.blob.fabric.microsoft.com';
const FILES_PATH = `${LAKEHOUSE_ID}/Files`;
/** Read-only SAS scopes: the tile pyramids and the browser-ready volumes, never the raw sources. */
const SLIDES_SCOPE = 'slides';
const VOLUMES_SCOPE = 'volumes';
const SAS_LIFETIME_MS = 55 * 60_000;
const SAS_REUSE_MS = 40 * 60_000;
const MAX_TILES_PER_CALL = 24;

export type AppSchema = Record<string, never>;

export type Hotspot = { x: number; y: number };

export type SlideChannel = {
  id: string;
  name: string;
  meaning: string;
  /** Display colour the tiles were rendered in, e.g. #2ee86a. */
  color: string;
  visible: boolean;
  dzi: string;
  tiles: string;
  tileCount: number;
  tilesBytes: number;
};

export type SlideInfo = {
  id: string;
  /** `brightfield` (default, H&E) or `fluorescence` (multiplexed, one tiled image per marker). */
  kind?: string;
  license?: string;
  channels?: SlideChannel[];
  markersAvailable?: number;
  title: string;
  organ: string;
  diagnosis: string;
  blurb: string;
  project: string;
  case: string;
  sourceFile: string;
  gdcFileId: string;
  source: string;
  sourceUrl: string;
  vendor: string | null;
  objectivePower: number | null;
  mpp: number | null;
  width: number;
  height: number;
  levels: number;
  tileSize: number;
  overlap: number;
  format: string;
  tileCount: number;
  tilesBytes?: number;
  hotspots: Hotspot[];
  rawSizeBytes: number;
  dzi: string;
  tiles: string;
  thumbnail: string;
  raw: string;
};

export type TileAccess = {
  /** `sas`: the browser streams tiles straight from OneLake; `proxy`: tiles come through `getTiles`. */
  mode: 'sas' | 'proxy';
  /** Base URL of the Lakehouse `Files` folder; slide paths in the manifest are relative to it. */
  baseUrl: string;
  /** SAS query string (without `?`) to append to tile URLs when mode is `sas`. */
  query: string;
  expiresOn: string;
  reason: string;
};

export type LakehouseInfo = {
  workspaceId: string;
  workspaceName: string;
  lakehouseId: string;
  lakehouseName: string;
  oneLakePath: string;
  portalUrl: string;
};

export type SlideCatalog = {
  title: string;
  generatedAt: string;
  slides: SlideInfo[];
  lakehouse: LakehouseInfo;
  tileAccess: TileAccess;
  servedAt: string;
};

export type TileBlob = { path: string; contentType: string; data: string };

export type VolumeLayer = {
  id: string;
  label: string;
  /** `ct` | `mri` | `overlay` | `labels` | `rgba` | `tracts` */
  kind: string;
  /** The file holds every timeline frame (4D NIfTI); frames switch instantly without reloading. */
  frames4d?: boolean;
  /** Path relative to Files/volumes; absent for timeline layers, which take it from each frame. */
  file?: string;
  /** Key into a timeline frame's `layers` map. */
  frameKey?: string;
  /** Path relative to Files/volumes of a NiiVue label lookup table. */
  lut?: string;
  colormap?: string;
  calMin?: number;
  calMax?: number;
  opacity?: number;
  visible?: boolean;
  unit?: string;
  bytes?: number;
};

export type VolumeFrame = {
  value: number;
  label: string;
  /** Short annotation shown with the frame, e.g. "lungs 5,106 ml". */
  note?: string;
  frameIndex?: number;
  brainVolumeMl?: number;
  layers: Record<string, string>;
  bytes: number;
};

export type VolumeStudy = {
  id: string;
  category: string;
  title: string;
  subtitle: string;
  modality: string;
  description: string;
  source: string;
  sourceUrl: string;
  license: string;
  citation: string;
  subject: string;
  patientId?: string;
  scanner?: string;
  thumbnail: string;
  rawPath: string;
  rawFiles: number;
  rawSizeBytes: number;
  sizeBytes: number;
  defaultView: string;
  /** Initial cut plane, for studies whose interior is the point (e.g. colour cryosections). */
  defaultClip?: { on: boolean; depth: number; face: 'front' | 'side' | 'top' };
  stats?: Record<string, number>;
  layers: VolumeLayer[];
  /** Starting 3D camera, when the default front view is not the best one (e.g. a face at three-quarters). */
  defaultCamera?: { azimuth: number; elevation: number };
  /** Colour preset id to open the 3D view with, e.g. `lungs`. */
  defaultPreset?: string;
  /** Views offered for this study; all when absent. */
  views?: string[];
  /** Precomputed rotating maximum intensity projection (sprite sheet). */
  mip?: { sprite: string; frames: number; cols: number; frameWidth: number; frameHeight: number; label: string; colormap: string; bytes: number };
  timeline?: {
    label: string;
    unit: string;
    initial: number;
    /** `files`: one file per frame (default); `frames4d`: frames inside one 4D file. */
    mode?: string;
    fps?: number;
    loop?: boolean;
    frames: VolumeFrame[];
  };
  dims: number[];
  spacingMm: number[];
};

export type FolderAccess = {
  /** Base URL of Files/volumes; study paths in the manifest are relative to it. */
  baseUrl: string;
  /** SAS query string (without `?`); empty when signing failed. */
  query: string;
  expiresOn: string;
  reason: string;
};

export type VolumeCatalog = {
  title: string;
  generatedAt: string;
  studies: VolumeStudy[];
  lakehouse: LakehouseInfo;
  access: FolderAccess;
  servedAt: string;
};

const cachedSas = new Map<string, { query: string; expiresOn: number; reuseUntil: number }>();

function oneLakeFileUrl(relativePath: string): string {
  return `${ONELAKE_DFS}/${WORKSPACE_ID}/${FILES_PATH}/${relativePath}`;
}

async function readOneLake(token: string, relativePath: string): Promise<Response> {
  const response = await fetch(oneLakeFileUrl(relativePath), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`OneLake read of ${relativePath} failed: ${response.status} ${response.statusText}`);
  }
  return response;
}

/** Signs a short-lived, read-only OneLake user-delegation SAS for one folder under Files/. */
async function signFolderSas(token: string, folder: string): Promise<{ query: string; expiresOn: number }> {
  const now = Date.now();
  const cached = cachedSas.get(folder);
  if (cached && cached.reuseUntil > now) return cached;
  const scope = `${FILES_PATH}/${folder}`;

  const credential = {
    getToken: async () => ({ token, expiresOnTimestamp: now + 30 * 60_000 }),
  };
  const service = new DataLakeServiceClient(ONELAKE_DFS, credential);
  const startsOn = new Date(now - 5 * 60_000);
  const expiresOn = new Date(now + SAS_LIFETIME_MS);
  const key = await service.getUserDelegationKey(startsOn, expiresOn);
  const query = generateDataLakeSASQueryParameters(
    {
      fileSystemName: WORKSPACE_ID,
      pathName: scope,
      isDirectory: true,
      directoryDepth: scope.split('/').length,
      permissions: DataLakeSASPermissions.parse('r'),
      protocol: SASProtocol.Https,
      startsOn,
      expiresOn,
    },
    key,
    'onelake',
  ).toString();
  const entry = { query, expiresOn: expiresOn.getTime(), reuseUntil: now + SAS_REUSE_MS };
  cachedSas.set(folder, entry);
  return entry;
}

function lakehouseInfo(): LakehouseInfo {
  return {
    workspaceId: WORKSPACE_ID,
    workspaceName: WORKSPACE_NAME,
    lakehouseId: LAKEHOUSE_ID,
    lakehouseName: LAKEHOUSE_NAME,
    oneLakePath: `abfss://${WORKSPACE_ID}@onelake.dfs.fabric.microsoft.com/${FILES_PATH}`,
    portalUrl: `https://app.fabric.microsoft.com/groups/${WORKSPACE_ID}/lakehouses/${LAKEHOUSE_ID}`,
  };
}

const udf = new UserDataFunctions();

/**
 * Reads the slide manifest from the Lakehouse and returns it with tile access details.
 * Runs as the Fabric app identity, which needs read access to the workspace.
 */
udf.func(
  'getSlideCatalog',
  async (ctx: RayfinContext<AppSchema, AudienceType.Storage>): Promise<SlideCatalog> => {
    const token = ctx.Tokens.Storage;
    const manifest = (await (await readOneLake(token, 'manifest.json')).json()) as {
      title: string;
      generatedAt: string;
      slides: SlideInfo[];
    };

    let tileAccess: TileAccess;
    try {
      const sas = await signFolderSas(token, SLIDES_SCOPE);
      tileAccess = {
        mode: 'sas',
        baseUrl: `${ONELAKE_BLOB}/${WORKSPACE_ID}/${FILES_PATH}`,
        query: sas.query,
        expiresOn: new Date(sas.expiresOn).toISOString(),
        reason: 'Short-lived read-only OneLake SAS scoped to Files/slides',
      };
    } catch (error) {
      console.error('OneLake SAS unavailable, falling back to tile proxy', error);
      tileAccess = {
        mode: 'proxy',
        baseUrl: '',
        query: '',
        expiresOn: '',
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    return {
      ...manifest,
      lakehouse: lakehouseInfo(),
      tileAccess,
      servedAt: new Date().toISOString(),
    };
  },
  [],
);

/**
 * Reads the 3D/4D volume manifest from the Lakehouse and signs read-only access to Files/volumes.
 * Runs as the Fabric app identity.
 */
udf.func(
  'getVolumeCatalog',
  async (ctx: RayfinContext<AppSchema, AudienceType.Storage>): Promise<VolumeCatalog> => {
    const token = ctx.Tokens.Storage;
    const manifest = (await (await readOneLake(token, `${VOLUMES_SCOPE}/manifest.json`)).json()) as {
      title: string;
      generatedAt: string;
      studies: VolumeStudy[];
    };
    let access: FolderAccess;
    try {
      const sas = await signFolderSas(token, VOLUMES_SCOPE);
      access = {
        baseUrl: `${ONELAKE_BLOB}/${WORKSPACE_ID}/${FILES_PATH}/${VOLUMES_SCOPE}`,
        query: sas.query,
        expiresOn: new Date(sas.expiresOn).toISOString(),
        reason: 'Short-lived read-only OneLake SAS scoped to Files/volumes',
      };
    } catch (error) {
      console.error('OneLake SAS unavailable for volumes', error);
      access = {
        baseUrl: '',
        query: '',
        expiresOn: '',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    return { ...manifest, lakehouse: lakehouseInfo(), access, servedAt: new Date().toISOString() };
  },
  [],
);

const SLIDE_ID = /^[a-z0-9-]{1,64}$/;
const TILE_PATH = /^((channels\/[a-z0-9-]{1,64}\/)?slide_files\/\d{1,2}\/\d{1,5}_\d{1,5}\.jpg|thumbnail\.jpg)$/;

/**
 * Fallback tile proxy: returns a small batch of tiles for one slide as base64 JPEGs.
 * Used only when the browser cannot load tiles directly from OneLake.
 */
udf.func(
  'getTiles',
  async (
    slideId: string,
    paths: string[],
    ctx: RayfinContext<AppSchema, AudienceType.Storage>,
  ): Promise<TileBlob[]> => {
    if (!SLIDE_ID.test(slideId)) throw new Error('Invalid slide id');
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_TILES_PER_CALL) {
      throw new Error(`Request between 1 and ${MAX_TILES_PER_CALL} tiles`);
    }
    if (!paths.every((p) => TILE_PATH.test(p))) throw new Error('Invalid tile path');

    const token = ctx.Tokens.Storage;
    return Promise.all(
      paths.map(async (path) => {
        const response = await readOneLake(token, `slides/${slideId}/${path}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        return { path, contentType: 'image/jpeg', data: bytes.toString('base64') };
      }),
    );
  },
  [],
);
