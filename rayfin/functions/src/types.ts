/**
 * Function schema types for RayfinClient.
 *
 * AUTO-GENERATED — do not edit manually.
 * Re-generated automatically when function source files change.
 *
 * If this file is not updating automatically, run:
 *   rayfin dev functions apply
 *
 * The schema is a closed object type: only the function names listed
 * below are accepted by RayfinClient.functions.<name>.invoke(...).
 * Adding, renaming, or changing the signature of a udf.func() call
 * regenerates this file and surfaces type errors at every consumer.
 *
 * IMPORTANT: This file must NOT import any Node.js packages — it is
 * resolved by the frontend app's TypeScript compiler.
 */

export type AppFunctionsSchema = {
  getSlideCatalog: {
    input: Record<string, never>;
    output: { title: string; generatedAt: string; slides: { id: string; caseInfo?: undefined | { patient: { caseId: string; project: string; projectName: string; primarySite: null | string; diseaseType: null | string; sex: null | string; ageAtDiagnosis: null | number; yearOfDiagnosis: null | number; primaryDiagnosis: null | string; morphology: null | string; tissueOrigin: null | string; site: null | string; stage: null | string; stagingSystem: string; t: null | string; n: null | string; m: null | string; grade: null | string; gleason: null | string; priorMalignancy: null | string; priorCancers: string[]; treatments: string[]; vitalStatus: null | string; survivalYears: null | number; followUpYears: null | number; gdcCaseUrl: string }; genomics: { mutations: { gene: string; change: string; type: string; impact: string; dna: string }[]; mutationCount: number; proteinChangingCount: number; copyNumber: null | { method: null | string; genesMeasured: number; ploidy: number; amplifiedFrom: number; fractionAltered: number; calls: { gene: string; copies: number; call: string; chromosome: string | null; }[]; callsTotal: number }; expression: null | { method: string; genesMeasured: number; panel: { gene: string; tpm: number; percentile: number; }[] } }; report: null | { file: string; bytes: number; gdcFileId: string; sourceUrl: string }; published: { type: string; category: null | string; files: number; bytes: number }[]; images: { key: string; barcode: string; label: string; sample: string; preparation: string; section?: undefined | null | string; composition: { [k: string]: number }; overlays: { id: string; kind: string; seriesUid: string; prefix?: string | undefined; format?: string | undefined; tileSize?: number | undefined; minLevel?: number | undefined; levels?: number | undefined; tileCount?: number | undefined; drawnTiles?: number | undefined; tilesBytes?: number | undefined; count?: number | null | undefined; file?: string | undefined; width?: number | undefined; patchUm?: number | undefined; patches?: number | undefined; positivePatches?: number | undefined; tissuePatches?: number | undefined; bytes?: number | undefined }[]; prefix?: undefined | string; gdcFileId?: undefined | string; sourceUrl?: undefined | string; sourceFile?: undefined | string; width?: undefined | number; height?: undefined | number; levels?: undefined | number; tileSize?: undefined | number; overlap?: undefined | number; format?: undefined | string; tileCount?: undefined | number; tilesBytes?: undefined | number; objectivePower?: undefined | null | number; mpp?: undefined | null | number; hotspots?: undefined | { x: number; y: number; }[]; rawSizeBytes?: undefined | number }[] }; study?: undefined | { studyInstanceUid: string; patientName: string; patientId: string; studyDate: string; studyTime: string; modalities: string; description: string }; kind?: undefined | string; license?: undefined | string; channels?: undefined | { id: string; name: string; meaning: string; group?: undefined | 'featured' | 'protein' | 'reference'; color: string; visible: boolean; dzi: string; tiles: string; tileCount: number; tilesBytes: number }[]; markersAvailable?: undefined | number; title: string; organ: string; diagnosis: string; blurb: string; project: string; case: string; sourceFile: string; gdcFileId: string; source: string; sourceUrl: string; vendor: null | string; objectivePower: null | number; mpp: null | number; width: number; height: number; levels: number; tileSize: number; overlap: number; format: string; tileCount: number; tilesBytes?: undefined | number; hotspots: { x: number; y: number }[]; rawSizeBytes: number; dzi: string; tiles: string; thumbnail: string; raw: string }[]; lakehouse: { workspaceId: string; workspaceName: string; lakehouseId: string; lakehouseName: string; oneLakePath: string; portalUrl: string }; tileAccess: { mode: 'sas' | 'proxy'; baseUrl: string; query: string; expiresOn: string; reason: string }; servedAt: string };
  };
  getVolumeCatalog: {
    input: Record<string, never>;
    output: { title: string; generatedAt: string; studies: { id: string; category: string; title: string; subtitle: string; modality: string; description: string; source: string; sourceUrl: string; license: string; citation: string; subject: string; patientId?: undefined | string; study?: undefined | { studyInstanceUid: string; patientName: string; patientId: string; studyDate: string; studyTime: string; modalities: string; description: string }; scanner?: undefined | string; thumbnail: string; rawPath: string; rawFiles: number; rawSizeBytes: number; sizeBytes: number; defaultView: string; defaultClip?: undefined | { on: boolean; depth: number; face: 'front' | 'side' | 'top' }; stats?: undefined | { [k: string]: number }; layers: { id: string; label: string; kind: string; frames4d?: undefined | false | true; file?: undefined | string; frameKey?: undefined | string; lut?: undefined | string; colormap?: undefined | string; calMin?: undefined | number; calMax?: undefined | number; opacity?: undefined | number; visible?: undefined | false | true; unit?: undefined | string; bytes?: undefined | number }[]; defaultCamera?: undefined | { azimuth: number; elevation: number }; defaultPreset?: undefined | string; views?: undefined | string[]; mip?: undefined | { sprite: string; frames: number; cols: number; frameWidth: number; frameHeight: number; label: string; colormap: string; bytes: number }; timeline?: undefined | { label: string; unit: string; initial: number; mode?: undefined | string; fps?: undefined | number; loop?: undefined | false | true; frames: { value: number; label: string; note?: undefined | string; frameIndex?: undefined | number; brainVolumeMl?: undefined | number; layers: { [k: string]: string }; bytes: number }[] }; dims: number[]; spacingMm: number[] }[]; lakehouse: { workspaceId: string; workspaceName: string; lakehouseId: string; lakehouseName: string; oneLakePath: string; portalUrl: string }; access: { baseUrl: string; query: string; expiresOn: string; reason: string }; servedAt: string };
  };
  getDicomAccess: {
    input: Record<string, never>;
    output: { baseUrl: string; query: string; expiresOn: string; reason: string };
  };
  getTiles: {
    input: { slideId: string; paths: string[] };
    output: { path: string; contentType: string; data: string }[];
  };
};
