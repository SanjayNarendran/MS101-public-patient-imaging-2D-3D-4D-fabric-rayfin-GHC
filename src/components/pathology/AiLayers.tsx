import { AI_BASICS, OVERLAY_NOTES } from '@/content/caseGuide';
import type { OverlayDisplay } from '@/components/SlideViewer';
import type { SlideOverlay } from '@/lib/cases';

export function overlaySummary(o: SlideOverlay): string | null {
  if (o.id === 'nuclei' && o.count) return `${o.count.toLocaleString()} nuclei found`;
  if (o.id === 'til' && o.tissuePatches) {
    const share = ((o.positivePatches ?? 0) / o.tissuePatches) * 100;
    return `Immune cells likely in ${share < 1 ? share.toFixed(1) : Math.round(share)}% of the tissue (${(o.positivePatches ?? 0).toLocaleString()} of ${o.tissuePatches.toLocaleString()} squares)`;
  }
  return null;
}

/** Toolbar chips that switch the AI layers of the current slide on and off. */
export function AiButtons({
  overlays,
  display,
  onToggle,
  onMore,
}: {
  overlays: SlideOverlay[];
  display: Record<string, OverlayDisplay>;
  onToggle: (id: string) => void;
  onMore: () => void;
}) {
  if (!overlays.length) return null;
  return (
    <span className="flex items-center gap-2">
      <button type="button" className="link t-faint text-[12px]" onClick={onMore} title="What the AI layers are, opacity and sources">
        AI
      </button>
      {overlays.map((o) => {
        const note = OVERLAY_NOTES[o.id];
        return (
          <button
            key={o.id}
            className="marker-chip"
            aria-pressed={!!display[o.id]?.visible}
            onClick={() => onToggle(o.id)}
            title={`${note?.short ?? o.id}. ${overlaySummary(o) ?? ''}`.trim()}
          >
            <span className="swatch" style={{ background: note?.legend.at(-1)?.color, color: note?.legend.at(-1)?.color }} />
            {note?.name.replace(' (AI)', '') ?? o.id}
          </button>
        );
      })}
    </span>
  );
}

/** Details › Controls: each AI layer with a switch, opacity, legend, what it shows and where it comes from. */
export function AiLayerControls({
  overlays,
  display,
  onUpdate,
}: {
  overlays: SlideOverlay[];
  display: Record<string, OverlayDisplay>;
  onUpdate: (id: string, patch: Partial<OverlayDisplay>) => void;
}) {
  if (!overlays.length) {
    return <p className="t-faint text-[12.5px]">No AI analysis has been published for this slide.</p>;
  }
  return (
    <>
      <p className="t-faint mb-4 text-[11.5px] leading-snug">{AI_BASICS}</p>
      <ul className="space-y-5">
        {overlays.map((o) => {
          const note = OVERLAY_NOTES[o.id];
          const d = display[o.id] ?? { visible: false, opacity: 0.8 };
          const summary = overlaySummary(o);
          return (
            <li key={o.id}>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" className="check" checked={d.visible} onChange={() => onUpdate(o.id, { visible: !d.visible })} />
                <span className="font-medium">{note?.name ?? o.id}</span>
              </label>
              <div className="mt-2 flex items-center gap-3 pl-6 text-[11.5px]">
                <span className="t-faint w-12">Opacity</span>
                <input
                  type="range"
                  className="range flex-1"
                  min={10}
                  max={100}
                  value={Math.round(d.opacity * 100)}
                  onChange={(e) => onUpdate(o.id, { opacity: Number(e.target.value) / 100, visible: true })}
                  aria-label={`${note?.name ?? o.id} opacity`}
                />
                <span className="t-faint w-8 text-right">{Math.round(d.opacity * 100)}%</span>
              </div>
              {note && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 pl-6 text-[11.5px]">
                  {note.legend.map((l) => (
                    <span key={l.label} className="flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />
                      {l.label}
                    </span>
                  ))}
                </div>
              )}
              {summary && <p className="mt-2 pl-6 text-[12px]">{summary}</p>}
              {note && (
                <>
                  <p className="t-muted mt-1.5 pl-6 text-[11.5px] leading-snug">{note.shows}</p>
                  <p className="t-faint mt-1.5 pl-6 text-[11.5px] leading-snug">{note.how}</p>
                  <p className="t-faint mt-1.5 pl-6 text-[11px] leading-snug">
                    {note.source}. {note.license}.{' '}
                    <a href={note.url} target="_blank" rel="noreferrer" className="link">
                      Dataset ↗
                    </a>
                  </p>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
