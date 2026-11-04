/**
 * Local data mode (`npm run dev:local`): runs the whole app on this computer, with no Fabric capacity,
 * backend or database. The Vite dev server serves the pipeline output in `work/` under `/local-data/`
 * (see `localDataPlugin` in vite.config.ts), and the catalogs below mirror what the Rayfin functions
 * return in Fabric, pointed at those local files.
 */
import type { SlideCatalog } from './catalog';
import type { VolumeCatalog } from './volumes';

export const LOCAL_DATA = import.meta.env.VITE_LOCAL_DATA === '1';

const LOCAL_LAKEHOUSE: SlideCatalog['lakehouse'] = {
  workspaceId: '',
  workspaceName: 'this computer',
  lakehouseId: '',
  lakehouseName: 'work',
  oneLakePath: 'work/ (local files)',
  portalUrl: '',
};

function base(folder: 'lakehouse' | 'volumes'): string {
  return `${window.location.origin}/local-data/${folder}`;
}

async function readJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}. Build the data first (see README, local mode).`);
  return (await res.json()) as T;
}

export async function fetchLocalSlideCatalog(): Promise<SlideCatalog> {
  const manifest = await readJson<Omit<SlideCatalog, 'lakehouse' | 'tileAccess' | 'servedAt'>>(
    `${base('lakehouse')}/manifest.json`
  );
  return {
    ...manifest,
    lakehouse: LOCAL_LAKEHOUSE,
    tileAccess: { mode: 'sas', baseUrl: base('lakehouse'), query: '', expiresOn: '', reason: 'Local files in work/lakehouse' },
    servedAt: new Date().toISOString(),
  };
}

export async function fetchLocalVolumeCatalog(): Promise<VolumeCatalog> {
  const manifest = await readJson<Omit<VolumeCatalog, 'lakehouse' | 'access' | 'servedAt'>>(
    `${base('volumes')}/manifest.json`
  );
  return {
    ...manifest,
    lakehouse: LOCAL_LAKEHOUSE,
    access: { baseUrl: base('volumes'), query: '', expiresOn: '', reason: 'Local files in work/volumes' },
    servedAt: new Date().toISOString(),
  };
}
