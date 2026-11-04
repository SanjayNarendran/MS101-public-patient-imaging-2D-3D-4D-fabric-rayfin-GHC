import { Fragment, type ReactNode } from 'react';

import { GENE_NOTES, stageNote } from '@/content/caseGuide';
import { formatYears, type CaseImage, type CaseInfo } from '@/lib/cases';

export function tidyDiagnosis(d: string | null | undefined): string | null {
  return d ? d.replace(/, NOS$/, '') : null;
}

export function tnm(p: CaseInfo['patient']): string | null {
  const parts = [p.t, p.n, p.m].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

export function outcome(p: CaseInfo['patient']): string | null {
  if (p.vitalStatus === 'Deceased') return p.survivalYears != null ? `Died ${formatYears(p.survivalYears)} after diagnosis` : 'Deceased';
  if (p.vitalStatus === 'Alive') return p.followUpYears != null ? `Alive at last contact, ${formatYears(p.followUpYears)} after diagnosis` : 'Alive at last contact';
  return null;
}

/** Huge genes that collect chance mutations; they are listed in the Case tab but never headlined. */
const PASSENGERS = new Set(['MUC16', 'MUC4', 'LRP1B', 'CSMD3', 'CDH10', 'FAT3', 'FAT4', 'FAM135B', 'CNTNAP2', 'PTPRD', 'KIAA1549']);

/** Headline gene changes: well-known drivers first, then amplifications, then other cancer genes. */
export function keyGenes(info: CaseInfo, max = 4): string[] {
  const out: string[] = [];
  const muts = info.genomics.mutations.filter((m) => !PASSENGERS.has(m.gene));
  const known = muts.filter((m) => GENE_NOTES[m.gene]);
  const amps = (info.genomics.copyNumber?.calls ?? []).filter((c) => c.call === 'amplified');
  const has = (gene: string) => out.some((g) => g.split(' ')[0] === gene);
  for (const m of known) {
    const label = m.gene === 'BRAF' && m.change === 'V640E' ? 'BRAF V600E' : /^[A-Z]\d+[A-Z]$/.test(m.change) ? `${m.gene} ${m.change}` : m.gene;
    if (!has(m.gene)) out.push(label);
  }
  for (const c of amps) if (!has(c.gene)) out.push(`${c.gene} amplified`);
  for (const m of muts) if (!has(m.gene)) out.push(m.gene);
  return out.slice(0, max);
}

function Item({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <span className="banner-item" title={title}>
      <span className="t-faint">{label}</span> <span className="font-medium">{children}</span>
    </span>
  );
}

/** Patient banner, as on a hospital imaging system: who, what and how far, always above the image. */
export function CaseBanner({
  info,
  image,
  onOpenCase,
  onHide,
}: {
  info: CaseInfo;
  image: CaseImage | null;
  onOpenCase: () => void;
  onHide: () => void;
}) {
  const p = info.patient;
  const genes = keyGenes(info);
  const items: ReactNode[] = [
    <Item key="case" label="Case">
      <span className="t-mono">{p.caseId}</span>
    </Item>,
  ];
  const who = [p.sex ? p.sex[0].toUpperCase() + p.sex.slice(1) : null, p.ageAtDiagnosis != null ? `${p.ageAtDiagnosis} at diagnosis` : null].filter(Boolean);
  if (who.length) items.push(<Item key="who" label="Patient">{who.join(', ')}</Item>);
  const dx = tidyDiagnosis(p.primaryDiagnosis);
  if (dx) items.push(<Item key="dx" label="Diagnosis">{dx}</Item>);
  if (p.stage)
    items.push(
      <Item key="stage" label="Stage" title={stageNote(p.stage) ?? undefined}>
        {[p.stage.replace(/^Stage /, ''), tnm(p) ? `(${tnm(p)})` : null].filter(Boolean).join(' ')}
      </Item>
    );
  else if (tnm(p)) items.push(<Item key="tnm" label="TNM">{tnm(p)}</Item>);
  if (p.grade) items.push(<Item key="grade" label="Grade">{p.grade}</Item>);
  if (p.gleason) items.push(<Item key="gleason" label="Gleason">{p.gleason}</Item>);
  const out = outcome(p);
  if (out) items.push(<Item key="out" label="Outcome">{out}</Item>);
  if (genes.length) items.push(<Item key="genes" label="Genes">{genes.join(', ')}</Item>);

  return (
    <div className="case-banner hair flex shrink-0 items-center gap-3 border-b px-4 py-1.5 text-[12.5px]">
      <button type="button" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 text-left" onClick={onOpenCase} title="Open the full case record (Details › Case)">
        {items.map((it, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="banner-sep" aria-hidden />}
            {it}
          </Fragment>
        ))}
      </button>
      {image && (
        <span className="t-faint hidden shrink-0 xl:inline" title={image.barcode}>
          {image.label}
        </span>
      )}
      <button type="button" className="link t-faint shrink-0 text-[11.5px]" onClick={onHide} title="Hide the banner (turn it back on in Details › Controls)">
        hide
      </button>
    </div>
  );
}
