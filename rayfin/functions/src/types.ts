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
    output: { title: string; generatedAt: string; slides: { id: string; kind?: undefined | string; license?: undefined | string; channels?: undefined | { id: string; name: string; meaning: string; color: string; visible: boolean; dzi: string; tiles: string; tileCount: number; tilesBytes: number }[]; markersAvailable?: undefined | number; title: string; organ: string; diagnosis: string; blurb: string; project: string; case: string; sourceFile: string; gdcFileId: string; source: string; sourceUrl: string; vendor: null | string; objectivePower: null | number; mpp: null | number; width: number; height: number; levels: number; tileSize: number; overlap: number; format: string; tileCount: number; tilesBytes?: undefined | number; hotspots: { x: number; y: number }[]; rawSizeBytes: number; dzi: string; tiles: string; thumbnail: string; raw: string }[]; lakehouse: { workspaceId: string; workspaceName: string; lakehouseId: string; lakehouseName: string; oneLakePath: string; portalUrl: string }; tileAccess: { mode: 'sas' | 'proxy'; baseUrl: string; query: string; expiresOn: string; reason: string }; servedAt: string };
  };
  getVolumeCatalog: {
    input: Record<string, never>;
    output: { title: string; generatedAt: string; studies: { id: string; category: string; title: string; subtitle: string; modality: string; description: string; source: string; sourceUrl: string; license: string; citation: string; subject: string; patientId?: undefined | string; scanner?: undefined | string; thumbnail: string; rawPath: string; rawFiles: number; rawSizeBytes: number; sizeBytes: number; defaultView: string; defaultClip?: undefined | { on: boolean; depth: number; face: 'front' | 'side' | 'top' }; stats?: undefined | { [k: string]: number }; layers: { id: string; label: string; kind: string; frames4d?: undefined | false | true; file?: undefined | string; frameKey?: undefined | string; lut?: undefined | string; colormap?: undefined | string; calMin?: undefined | number; calMax?: undefined | number; opacity?: undefined | number; visible?: undefined | false | true; unit?: undefined | string; bytes?: undefined | number }[]; defaultCamera?: undefined | { azimuth: number; elevation: number }; defaultPreset?: undefined | string; views?: undefined | string[]; mip?: undefined | { sprite: string; frames: number; cols: number; frameWidth: number; frameHeight: number; label: string; colormap: string; bytes: number }; timeline?: undefined | { label: string; unit: string; initial: number; mode?: undefined | string; fps?: undefined | number; loop?: undefined | false | true; frames: { value: number; label: string; note?: undefined | string; frameIndex?: undefined | number; brainVolumeMl?: undefined | number; layers: { [k: string]: string }; bytes: number }[] }; dims: number[]; spacingMm: number[] }[]; lakehouse: { workspaceId: string; workspaceName: string; lakehouseId: string; lakehouseName: string; oneLakePath: string; portalUrl: string }; access: { baseUrl: string; query: string; expiresOn: string; reason: string }; servedAt: string };
  };
  getTiles: {
    input: { slideId: string; paths: string[] };
    output: { path: string; contentType: string; data: string }[];
  };
};
