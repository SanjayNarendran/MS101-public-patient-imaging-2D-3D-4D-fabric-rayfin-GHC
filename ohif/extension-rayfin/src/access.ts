/**
 * Where the DICOM files are and how to read them.
 *
 * Inside the Rayfin app, OHIF runs in a same-origin frame and asks its parent (`window.parent.rayfinDicom`) for the
 * Lakehouse folder and a short-lived, read-only OneLake SAS. In local data mode the parent answers with the Vite dev
 * server's `/local-data/dicom` folder and no SAS. Opened on its own, OHIF falls back to `/local-data/dicom`.
 */
export type Access = {
  /** Folder that holds `<dataset>/studies.json`, e.g. `https://onelake.blob.fabric.microsoft.com/<ws>/<lh>/Files/dicom`. */
  baseUrl: string;
  /** SAS query string without `?`; empty for local files. */
  query: string;
  /** ISO time the SAS stops working; empty when it never expires. */
  expiresOn?: string;
};

type Bridge = { getAccess: () => Promise<Access> };

const REFRESH_BEFORE_MS = 5 * 60_000;
let cached: { access: Access; expires: number } | null = null;
let pending: Promise<Access> | null = null;

function bridge(): Bridge | undefined {
  try {
    return (window.parent as unknown as { rayfinDicom?: Bridge })?.rayfinDicom;
  } catch {
    return undefined; // a cross-origin parent cannot be read
  }
}

export async function getAccess(): Promise<Access> {
  if (cached && cached.expires - Date.now() > REFRESH_BEFORE_MS) {
    return cached.access;
  }
  pending ??= (async () => {
    const b = bridge();
    const access: Access = b
      ? await b.getAccess()
      : { baseUrl: `${window.location.origin}/local-data/dicom`, query: '' };
    const expires = access.expiresOn ? Date.parse(access.expiresOn) : Number.POSITIVE_INFINITY;
    cached = { access, expires };
    return access;
  })().finally(() => {
    pending = null;
  });
  return pending;
}

/** Adds the SAS (if any) to a URL inside the DICOM folder. */
export function sign(url: string, access: Access): string {
  if (!access.query) {
    return url;
  }
  return `${url}${url.includes('?') ? '&' : '?'}${access.query}`;
}

/** GET with an optional byte range, signed with the current SAS. */
export async function fetchBytes(url: string, range?: [number, number]): Promise<ArrayBuffer> {
  const access = await getAccess();
  const headers: Record<string, string> = {};
  if (range) {
    headers.Range = `bytes=${range[0]}-${range[0] + range[1] - 1}`;
  }
  const res = await fetch(sign(url, access), { headers });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} reading ${url.split('?')[0]}`);
  }
  const buffer = await res.arrayBuffer();
  // A server that ignores Range returns the whole file; cut out the part that was asked for.
  if (range && res.status === 200 && buffer.byteLength !== range[1]) {
    return buffer.slice(range[0], range[0] + range[1]);
  }
  return buffer;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const access = await getAccess();
  const res = await fetch(sign(url, access));
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} reading ${url.split('?')[0]}`);
  }
  return (await res.json()) as T;
}
