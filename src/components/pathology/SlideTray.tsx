import { LakehouseImage } from '@/components/LakehouseImage';
import { COMPOSITION_LABELS } from '@/content/caseGuide';
import type { CaseImage } from '@/lib/cases';
import type { Slide, TileAccess } from '@/lib/catalog';

function thumbPath(image: CaseImage): string {
  return image.key === 'main' ? 'thumbnail.jpg' : `${image.prefix ?? `case/${image.key}/`}thumbnail.jpg`;
}

/** Filmstrip of every slide from the patient, under the viewer. Click to view; ⇆ shows it beside the current one. */
export function SlideTray({
  slide,
  access,
  images,
  current,
  compare,
  onSelect,
  onCompare,
  onHide,
}: {
  slide: Slide;
  access: TileAccess;
  images: CaseImage[];
  current: string;
  compare: string | null;
  onSelect: (key: string) => void;
  onCompare: (key: string) => void;
  onHide: () => void;
}) {
  return (
    <div className="slide-tray hair flex shrink-0 items-stretch gap-3 border-t px-4 py-2">
      <div className="flex w-[92px] shrink-0 flex-col justify-center text-[11.5px] leading-tight">
        <span className="font-medium" style={{ color: 'var(--ink)' }}>
          Slides from this patient
        </span>
        <span className="t-faint mt-0.5">{images.length === 1 ? '1 slide' : `${images.length} slides`}</span>
        <button type="button" className="link t-faint mt-1 self-start" onClick={onHide} title="Hide the filmstrip (turn it back on in Details › Controls)">
          hide
        </button>
      </div>
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5">
        {images.map((img) => {
          const composition = Object.entries(img.composition);
          const tip = [
            img.barcode,
            img.preparation === 'FFPE' ? 'Formalin-fixed, paraffin-embedded (diagnostic quality)' : 'Frozen section',
            composition.length ? composition.map(([k, v]) => `${COMPOSITION_LABELS[k] ?? k} ${v}%`).join(', ') : null,
            img.overlays.length ? `AI layers: ${img.overlays.map((o) => (o.id === 'til' ? 'immune cells' : 'nuclei')).join(', ')}` : null,
          ]
            .filter(Boolean)
            .join('\n');
          return (
            <div key={img.key} className="tray-item" aria-current={img.key === current} data-compare={img.key === compare || undefined}>
              <button type="button" className="flex items-center gap-2 text-left" onClick={() => onSelect(img.key)} title={tip}>
                <LakehouseImage access={access} slide={slide} path={thumbPath(img)} alt="" className="tray-thumb" loading="lazy" />
                <span className="min-w-0">
                  <span className="block max-w-[150px] truncate text-[12px] font-medium">{img.label}</span>
                  <span className="t-faint block text-[11px]">
                    {img.preparation === 'FFPE' ? 'FFPE' : 'Frozen'}
                    {img.sample === 'Normal tissue' ? ' · normal' : ''}
                    {img.overlays.length ? ' · AI' : ''}
                    {img.key === compare ? ' · right' : ''}
                  </span>
                </span>
              </button>
              <button type="button" className="tray-compare" onClick={() => onCompare(img.key)} title="Show beside the current slide" aria-label={`Compare with ${img.label}`}>
                ⇆
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
