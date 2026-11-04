import { lakehouseUrl, loadViaProxy, type Slide, type TileAccess } from './catalog';

export type CaseInfo = NonNullable<Slide['caseInfo']>;
export type CaseImage = CaseInfo['images'][number];
export type SlideOverlay = CaseImage['overlays'][number];

/** A slide as the viewer sees it: the catalog slide, or another slide from the same case under `prefix`. */
export type ViewSlide = Slide & { imageKey: string; prefix: string; overlays: SlideOverlay[] };

export function caseImages(slide: Slide): CaseImage[] {
  return slide.caseInfo?.images ?? [];
}

export function findImage(slide: Slide, key: string | null): CaseImage | null {
  const images = caseImages(slide);
  return images.find((i) => i.key === key) ?? images[0] ?? null;
}

export function viewSlideFor(slide: Slide, image: CaseImage | null): ViewSlide {
  if (!image || image.key === 'main' || !image.width || !image.height || !image.levels) {
    return { ...slide, imageKey: 'main', prefix: '', overlays: image?.overlays ?? [] };
  }
  const prefix = image.prefix ?? `case/${image.key}/`;
  return {
    ...slide,
    imageKey: image.key,
    prefix,
    overlays: image.overlays,
    kind: 'brightfield',
    channels: undefined,
    width: image.width,
    height: image.height,
    levels: image.levels,
    tileSize: image.tileSize ?? slide.tileSize,
    overlap: image.overlap ?? slide.overlap,
    format: image.format ?? 'jpg',
    tileCount: image.tileCount ?? 0,
    tilesBytes: image.tilesBytes,
    objectivePower: image.objectivePower ?? null,
    mpp: image.mpp ?? null,
    hotspots: image.hotspots ?? [],
    rawSizeBytes: image.rawSizeBytes ?? 0,
    sourceFile: image.sourceFile ?? slide.sourceFile,
    sourceUrl: image.sourceUrl ?? slide.sourceUrl,
    gdcFileId: image.gdcFileId ?? slide.gdcFileId,
    thumbnail: `${prefix}thumbnail.jpg`,
  };
}

/** Pins on other case slides are stored under `<slide>/<image>` so they never land on the wrong image. */
export function pinKey(view: ViewSlide): string {
  return view.imageKey === 'main' ? view.id : `${view.id}/${view.imageKey}`;
}

/** Fetches a Lakehouse file (SAS or proxy) as an object URL with the given content type. */
export async function lakehouseObjectUrl(access: TileAccess, slide: Slide, path: string, type: string): Promise<string> {
  const url = lakehouseUrl(access, slide, path);
  let blob: Blob;
  if (access.mode === 'sas') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    blob = new Blob([await res.arrayBuffer()], { type });
  } else {
    const dataUrl = await loadViaProxy(url);
    blob = await (await fetch(dataUrl)).blob();
    blob = new Blob([blob], { type });
  }
  return URL.createObjectURL(blob);
}

export function sampleShort(image: CaseImage): string {
  return [image.sample, image.preparation === 'FFPE' ? 'FFPE' : 'frozen'].join(' · ');
}

export function formatYears(y: number): string {
  if (y < 1) return `${Math.max(1, Math.round(y * 12))} months`;
  return `${y.toFixed(y < 10 ? 1 : 0)} years`;
}
