import { fetchBytes, fetchJson } from './access';
import type { InstanceEntry } from './dataSource';

/**
 * The data client that dicom-microscopy-viewer calls for slide tiles and annotations, in place of a DICOMweb client.
 * Every tile is one HTTP range request into the original .dcm file in OneLake, located with the frame index
 * written by pipeline/dicom/build_dicom.py; annotation coordinates are range reads too.
 */
type Deps = {
  entriesBySop: Map<string, InstanceEntry>;
  seriesMetadata: (StudyInstanceUID: string, SeriesInstanceUID: string) => Promise<InstanceEntry[]>;
};

type FrameOptions = {
  studyInstanceUID: string;
  seriesInstanceUID: string;
  sopInstanceUID: string;
  frameNumbers: number[] | string;
};

const frameIndexes = new Map<string, Promise<Float64Array>>();

async function frameIndex(entry: InstanceEntry): Promise<Float64Array> {
  if (!entry.frames) {
    throw new Error(`No frame index for ${entry.file.split('?')[0]}`);
  }
  let p = frameIndexes.get(entry.frames);
  if (!p) {
    p = fetchBytes(entry.frames).then(buffer => new Float64Array(buffer));
    frameIndexes.set(entry.frames, p);
    p.catch(() => frameIndexes.delete(entry.frames!));
  }
  return p;
}

function parseBulkDataURI(uri: string): { url: string; range?: [number, number] } {
  const hash = uri.lastIndexOf('#');
  if (hash === -1) {
    return { url: uri };
  }
  const [offset, length] = uri.slice(hash + 1).split(',').map(Number);
  return { url: uri.slice(0, hash), range: [offset, length] };
}

export function createMicroscopyClient({ entriesBySop, seriesMetadata }: Deps) {
  async function entryFor(o: { studyInstanceUID: string; seriesInstanceUID: string; sopInstanceUID: string }) {
    let entry = entriesBySop.get(o.sopInstanceUID);
    if (!entry) {
      await seriesMetadata(o.studyInstanceUID, o.seriesInstanceUID);
      entry = entriesBySop.get(o.sopInstanceUID);
    }
    if (!entry) {
      throw new Error(`Instance ${o.sopInstanceUID} is not in the catalog`);
    }
    return entry;
  }

  return {
    wadoURL: 'onelake',
    headers: {},

    async retrieveInstanceFrames(options: FrameOptions): Promise<ArrayBuffer[]> {
      const entry = await entryFor(options);
      const index = await frameIndex(entry);
      const numbers = (Array.isArray(options.frameNumbers)
        ? options.frameNumbers
        : String(options.frameNumbers).split(',')
      ).map(Number);
      return Promise.all(
        numbers.map(n => {
          const offset = index[(n - 1) * 2];
          const length = index[(n - 1) * 2 + 1];
          if (offset === undefined || length === undefined) {
            throw new Error(`Frame ${n} is outside instance ${options.sopInstanceUID}`);
          }
          return fetchBytes(entry.file, [offset, length]);
        })
      );
    },

    async retrieveBulkData(options: { BulkDataURI: string }): Promise<ArrayBuffer[]> {
      const { url, range } = parseBulkDataURI(options.BulkDataURI);
      return [await fetchBytes(url, range)];
    },

    async retrieveSeriesMetadata(options: { studyInstanceUID: string; seriesInstanceUID: string }) {
      const entries = await seriesMetadata(options.studyInstanceUID, options.seriesInstanceUID);
      return entries.map(e => structuredClone(e.dicom));
    },

    async retrieveInstanceMetadata(options: { studyInstanceUID: string; seriesInstanceUID: string; sopInstanceUID: string }) {
      return [structuredClone((await entryFor(options)).dicom)];
    },

    async retrieveInstance(options: { studyInstanceUID: string; seriesInstanceUID: string; sopInstanceUID: string }) {
      return fetchBytes((await entryFor(options)).file);
    },

    async searchForSeries() {
      return [];
    },

    async searchForInstances() {
      return [];
    },

    fetchJson,
  };
}
