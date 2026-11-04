import OHIF, { DicomMetadataStore, IWebApiDataSource } from '@ohif/core';
import dcmjs from 'dcmjs';

import { fetchJson, getAccess, sign, type Access } from './access';
import { createMicroscopyClient } from './microscopyClient';

const { naturalizeDataset } = dcmjs.data.DicomMetaDictionary;
const metadataProvider = OHIF.classes.MetadataProvider;

/** One row of `<dataset>/studies.json`, written by pipeline/dicom/build_dicom.py. */
type StudyRow = {
  StudyInstanceUID: string;
  PatientName: string;
  PatientID: string;
  StudyDate: string;
  StudyTime: string;
  StudyDescription: string;
  AccessionNumber: string;
  ModalitiesInStudy: string;
  NumberOfStudyRelatedSeries: number;
  NumberOfStudyRelatedInstances: number;
};

type SeriesRow = {
  SeriesInstanceUID: string;
  Modality: string;
  SeriesDescription: string;
  SeriesNumber: number;
  SeriesDate: string;
  SeriesTime: string;
  NumberOfSeriesRelatedInstances: number;
  metadata: string;
  thumbnail?: string;
  /** Fluorescence slides: starting channel colours and contrast windows. */
  display?: string;
};

type StudyFile = { StudyInstanceUID: string; series: SeriesRow[] };

/** One entry of `series/<uid>/metadata.json`: the original file, its frame index (slides) and its DICOM JSON. */
export type InstanceEntry = { file: string; frames?: string; dicom: Record<string, any> };

export type RayfinDataSourceConfig = {
  friendlyName: string;
  /** Folder under Files/dicom: `pathology` or `radiology`. */
  dataset: string;
};

function hidden(obj: object, key: string, value: unknown) {
  Object.defineProperty(obj, key, { value, enumerable: false, writable: true, configurable: true });
}

/** Makes byte-range BulkDataURIs ("files/x.dcm#offset,length") absolute, so OHIF and the slide viewer keep them. */
function absoluteBulkData(node: any, root: string) {
  if (Array.isArray(node)) {
    node.forEach(n => absoluteBulkData(n, root));
    return;
  }
  if (!node || typeof node !== 'object') {
    return;
  }
  if (typeof node.BulkDataURI === 'string' && !/^https?:/.test(node.BulkDataURI)) {
    node.BulkDataURI = `${root}/${node.BulkDataURI}`;
  }
  Object.values(node).forEach(v => absoluteBulkData(v, root));
}

function matches(value: string, pattern?: string) {
  if (!pattern) {
    return true;
  }
  const needle = pattern.replace(/\*/g, '').toLowerCase();
  return value.toLowerCase().includes(needle);
}

export function createRayfinDataSource(configuration: RayfinDataSourceConfig) {
  const { dataset } = configuration;
  let studiesPromise: Promise<StudyRow[]> | null = null;
  const studyFiles = new Map<string, Promise<StudyFile>>();
  const seriesEntries = new Map<string, Promise<InstanceEntry[]>>();
  /** SOPInstanceUID → entry, for the slide viewer's frame index lookups. */
  const entriesBySop = new Map<string, InstanceEntry>();

  const root = (access: Access) => `${access.baseUrl}/${dataset}`;

  async function studies(): Promise<StudyRow[]> {
    studiesPromise ??= getAccess()
      .then(access => fetchJson<{ studies: StudyRow[] }>(`${root(access)}/studies.json`))
      .then(d => d.studies)
      .catch(error => {
        studiesPromise = null;
        throw error;
      });
    return studiesPromise;
  }

  async function studyFile(StudyInstanceUID: string): Promise<StudyFile> {
    let p = studyFiles.get(StudyInstanceUID);
    if (!p) {
      p = getAccess().then(access => fetchJson<StudyFile>(`${root(access)}/studies/${StudyInstanceUID}.json`));
      studyFiles.set(StudyInstanceUID, p);
      p.catch(() => studyFiles.delete(StudyInstanceUID));
    }
    return p;
  }

  async function seriesMetadata(series: SeriesRow): Promise<InstanceEntry[]> {
    let p = seriesEntries.get(series.SeriesInstanceUID);
    if (!p) {
      p = (async () => {
        const access = await getAccess();
        const base = root(access);
        const entries = await fetchJson<InstanceEntry[]>(`${base}/${series.metadata}`);
        entries.forEach(e => {
          absoluteBulkData(e.dicom, base);
          e.file = `${base}/${e.file}`;
          if (e.frames) {
            e.frames = `${base}/${e.frames}`;
          }
          const sop = e.dicom['00080018']?.Value?.[0];
          if (sop) {
            entriesBySop.set(sop, e);
          }
        });
        return entries;
      })();
      seriesEntries.set(series.SeriesInstanceUID, p);
      p.catch(() => seriesEntries.delete(series.SeriesInstanceUID));
    }
    return p;
  }

  /** `dicomweb:` image id: Cornerstone fetches the original file once and caches it. Frames are 1-based. */
  async function imageIdFor(file: string, frame?: number) {
    const access = await getAccess();
    const url = sign(file, access);
    return `dicomweb:${url}${frame ? `${url.includes('?') ? '&' : '?'}frame=${frame}` : ''}`;
  }

  const implementation = {
    initialize: async () => {
      await studies();
    },
    query: {
      studies: {
        mapParams: () => undefined,
        search: async (params: Record<string, any> = {}) => {
          const rows = await studies();
          const modalities: string[] | undefined = params.modalitiesInStudy;
          const exact = params.disableWildcard === true;
          return rows
            .filter(
              r =>
                (!params.studyInstanceUid || r.StudyInstanceUID === params.studyInstanceUid) &&
                matches(r.PatientName, params.patientName) &&
                (exact && params.patientId ? r.PatientID === params.patientId : matches(r.PatientID, params.patientId)) &&
                matches(r.StudyDescription, params.studyDescription) &&
                matches(r.AccessionNumber, params.accessionNumber) &&
                (!params.startDate || r.StudyDate >= params.startDate) &&
                (!params.endDate || r.StudyDate <= params.endDate) &&
                (!modalities?.length || modalities.some(m => r.ModalitiesInStudy.split('\\').includes(m)))
            )
            .map(r => ({
              studyInstanceUid: r.StudyInstanceUID,
              patientName: r.PatientName,
              mrn: r.PatientID,
              date: r.StudyDate,
              time: r.StudyTime,
              description: r.StudyDescription,
              accession: r.AccessionNumber,
              modalities: r.ModalitiesInStudy,
              instances: r.NumberOfStudyRelatedInstances,
            }));
        },
        processResults: (results: unknown) => results,
      },
      series: {
        search: async (studyInstanceUid: string) => {
          const study = await studyFile(studyInstanceUid);
          return study.series.map(s => ({
            studyInstanceUid,
            seriesInstanceUid: s.SeriesInstanceUID,
            modality: s.Modality,
            seriesNumber: String(s.SeriesNumber ?? ''),
            seriesDate: s.SeriesDate,
            numSeriesInstances: s.NumberOfSeriesRelatedInstances,
            description: s.SeriesDescription,
          }));
        },
      },
      instances: {
        search: () => [],
      },
    },
    retrieve: {
      /** Thumbnails come from the pipeline (series/<uid>/thumbnail.jpg) rather than being rendered on the fly. */
      getGetThumbnailSrc: (context: { StudyInstanceUID?: string; SeriesInstanceUID?: string }) => {
        return async () => {
          if (!context?.StudyInstanceUID || !context.SeriesInstanceUID) {
            return null;
          }
          const study = await studyFile(context.StudyInstanceUID);
          const series = study.series.find(s => s.SeriesInstanceUID === context.SeriesInstanceUID);
          if (!series?.thumbnail) {
            return null;
          }
          const access = await getAccess();
          return sign(`${root(access)}/${series.thumbnail}`, access);
        };
      },
      directURL: (params: { instance?: { imageId?: string } }) => params?.instance?.imageId?.replace(/^dicomweb:/, ''),
      /** Starting display of a fluorescence slide (see fluorescence.ts), or null. */
      displayPresets: async (StudyInstanceUID: string, SeriesInstanceUID: string) => {
        const study = await studyFile(StudyInstanceUID);
        const series = study.series.find(s => s.SeriesInstanceUID === SeriesInstanceUID);
        if (!series?.display) {
          return null;
        }
        const access = await getAccess();
        return fetchJson(`${root(access)}/${series.display}`);
      },
      /** The slide viewer's data client (patched into @ohif/extension-dicom-microscopy). */
      microscopyClient: () => createMicroscopyClient({ entriesBySop, seriesMetadata: loadSeriesEntries }),
      /** The same client for Cornerstone's whole-slide viewport, which opens slides outside Microscopy mode. */
      getWadoDicomWebClient: () => createMicroscopyClient({ entriesBySop, seriesMetadata: loadSeriesEntries }),
      series: {
        metadata: async ({
          StudyInstanceUID,
          filters = {},
          madeInClient = false,
        }: {
          StudyInstanceUID: string;
          filters?: Record<string, any>;
          madeInClient?: boolean;
        }) => {
          const study = await studyFile(StudyInstanceUID);
          const rows = await studies();
          const studyRow = rows.find(r => r.StudyInstanceUID === StudyInstanceUID);
          const wanted: string[] | undefined = filters.seriesInstanceUID || filters.SeriesInstanceUID;
          const series = wanted?.length
            ? study.series.filter(s => wanted.includes(s.SeriesInstanceUID))
            : study.series;

          DicomMetadataStore.addSeriesMetadata(
            series.map(s => ({
              StudyInstanceUID,
              SeriesInstanceUID: s.SeriesInstanceUID,
              Modality: s.Modality,
              SeriesDescription: s.SeriesDescription,
              SeriesNumber: s.SeriesNumber,
              SeriesDate: s.SeriesDate,
              SeriesTime: s.SeriesTime,
              NumberOfSeriesRelatedInstances: s.NumberOfSeriesRelatedInstances,
              PatientID: studyRow?.PatientID,
              PatientName: studyRow?.PatientName,
              StudyDescription: studyRow?.StudyDescription,
              StudyDate: studyRow?.StudyDate,
            })),
            madeInClient
          );

          await Promise.all(
            series.map(async s => {
              const entries = await seriesMetadata(s);
              const instances = await Promise.all(
                entries.map(async e => {
                  const instance = naturalizeDataset(structuredClone(e.dicom));
                  const imageId = await imageIdFor(e.file);
                  hidden(instance, 'imageId', imageId);
                  // Non-image objects (RTSTRUCT, SR) are fetched whole from this URL; no wadoRoot, so OHIF never tries DICOMweb.
                  hidden(instance, 'url', imageId);
                  const frames = Number(instance.NumberOfFrames) || 1;
                  metadataProvider.addImageIdToUIDs(imageId, {
                    StudyInstanceUID,
                    SeriesInstanceUID: s.SeriesInstanceUID,
                    SOPInstanceUID: instance.SOPInstanceUID,
                  });
                  if (frames > 1 && instance.Modality !== 'SM') {
                    for (let f = 1; f <= frames; f++) {
                      metadataProvider.addImageIdToUIDs(await imageIdFor(e.file, f), {
                        StudyInstanceUID,
                        SeriesInstanceUID: s.SeriesInstanceUID,
                        SOPInstanceUID: instance.SOPInstanceUID,
                        frameNumber: f,
                      });
                    }
                  }
                  return instance;
                })
              );
              DicomMetadataStore.addInstances(instances, madeInClient);
            })
          );

          const stored = DicomMetadataStore.getStudy(StudyInstanceUID, madeInClient);
          if (stored) {
            stored.isLoaded = true;
          }
        },
      },
    },
    store: {
      dicom: () => {
        throw new Error('This viewer is read-only: images are stored in the Fabric Lakehouse.');
      },
    },
    reject: {},
    deleteStudyMetadataPromise: () => undefined,
    getImageIdsForDisplaySet(displaySet: { images?: Array<{ imageId?: string; NumberOfFrames?: number; SOPInstanceUID: string }> }) {
      const imageIds: string[] = [];
      (displaySet.images || []).forEach(instance => {
        const frames = Number(instance.NumberOfFrames) || 1;
        if (frames > 1 && instance.imageId) {
          for (let f = 1; f <= frames; f++) {
            imageIds.push(`${instance.imageId}${instance.imageId.includes('?') ? '&' : '?'}frame=${f}`);
          }
        } else if (instance.imageId) {
          imageIds.push(instance.imageId);
        }
      });
      return imageIds;
    },
    getImageIdsForInstance({ instance, frame }: { instance: { imageId?: string }; frame?: number }) {
      if (!instance?.imageId) {
        return undefined;
      }
      if (!frame) {
        return instance.imageId;
      }
      return `${instance.imageId}${instance.imageId.includes('?') ? '&' : '?'}frame=${frame}`;
    },
    getStudyInstanceUIDs: ({ query }: { query: URLSearchParams }) => {
      const uids = query.get('StudyInstanceUIDs') || query.get('studyInstanceUIDs');
      return uids ? uids.split(',') : undefined;
    },
    getConfig: () => ({
      ...configuration,
      // Thumbnails come from getGetThumbnailSrc; tells the worklist preview to ask for them.
      thumbnailRequestStrategy: 'fetch',
      dicomUploadEnabled: false,
      // Keeps OHIF's BulkDataURI fixer from rewriting our absolute byte-range URIs.
      wadoRoot: '/rayfin-onelake',
      singlepart: 'bulkdata,video,pdf',
    }),
  };

  async function loadSeriesEntries(StudyInstanceUID: string, SeriesInstanceUID: string): Promise<InstanceEntry[]> {
    const study = await studyFile(StudyInstanceUID);
    const series = study.series.find(s => s.SeriesInstanceUID === SeriesInstanceUID);
    if (!series) {
      throw new Error(`Series ${SeriesInstanceUID} is not in study ${StudyInstanceUID}`);
    }
    return seriesMetadata(series);
  }

  return IWebApiDataSource.create(implementation as any);
}
