import { useState } from 'react';
import { Link } from 'react-router-dom';

import { PanelRow, PanelSection } from '@/components/Panel';
import {
  changeNote,
  COMPOSITION_LABELS,
  geneNote,
  PUBLISHED_NOTES,
  GLEASON_NOTE,
  stageNote,
  TNM_NOTE,
} from '@/content/caseGuide';
import { type CaseImage, type CaseInfo } from '@/lib/cases';
import { formatBytes } from '@/lib/catalog';

import { outcome, tidyDiagnosis, tnm } from './CaseBanner';

const MUTATIONS_SHOWN = 8;

function Bar({ value, max = 100, color = 'var(--accent)' }: { value: number; max?: number; color?: string }) {
  return (
    <span className="bar" aria-hidden>
      <span style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
    </span>
  );
}

function Composition({ image }: { image: CaseImage }) {
  const entries = Object.entries(image.composition);
  if (!entries.length) return <p className="t-faint text-[12px]">No composition estimate was recorded for this section.</p>;
  return (
    <ul className="space-y-1.5">
      {entries.map(([k, v]) => (
        <li key={k} className="grid grid-cols-[100px_1fr_36px] items-center gap-2 text-[12px]">
          <span className="t-faint">{COMPOSITION_LABELS[k] ?? k}</span>
          <Bar value={v} />
          <span className="text-right tabular-nums">{v}%</span>
        </li>
      ))}
    </ul>
  );
}

/** Details › Case: the patient record, tumour genes, this section, the report and what else is published. */
export function CasePanel({
  info,
  image,
  reportOpen,
  onOpenReport,
}: {
  info: CaseInfo;
  image: CaseImage | null;
  reportOpen: boolean;
  onOpenReport: (() => void) | null;
}) {
  const p = info.patient;
  const g = info.genomics;
  const [allMutations, setAllMutations] = useState(false);
  const mutations = allMutations ? g.mutations : g.mutations.slice(0, MUTATIONS_SHOWN);
  const stage = stageNote(p.stage);
  const out = outcome(p);
  const amplified = g.copyNumber?.calls.filter((c) => c.call === 'amplified') ?? [];
  const deleted = g.copyNumber?.calls.filter((c) => c.call === 'deleted') ?? [];

  return (
    <>
      <PanelSection title="Patient" aside={<Link to="/guide#case" className="link">What these mean</Link>}>
        <dl>
          <PanelRow term="Case">
            <span className="t-mono">{p.caseId}</span>
          </PanelRow>
          <PanelRow term="Study">{p.projectName} ({p.project})</PanelRow>
          {p.sex && <PanelRow term="Sex">{p.sex[0].toUpperCase() + p.sex.slice(1)}</PanelRow>}
          {p.ageAtDiagnosis != null && <PanelRow term="Age">{p.ageAtDiagnosis} at diagnosis</PanelRow>}
          {tidyDiagnosis(p.primaryDiagnosis) && <PanelRow term="Diagnosis">{tidyDiagnosis(p.primaryDiagnosis)}</PanelRow>}
          {(p.site || p.tissueOrigin) && <PanelRow term="Site">{tidyDiagnosis(p.site ?? p.tissueOrigin)}</PanelRow>}
          {p.morphology && <PanelRow term="ICD-O code">{p.morphology}</PanelRow>}
          {p.stage && (
            <PanelRow term="Stage">
              {p.stage}
              {stage && <span className="t-faint block text-[11.5px] leading-snug">{stage}</span>}
            </PanelRow>
          )}
          {tnm(p) && (
            <PanelRow term="TNM">
              <span title={TNM_NOTE}>{tnm(p)}</span>
              <span className="t-faint block text-[11.5px] leading-snug">{p.stagingSystem}. T: tumour size and reach; N: lymph nodes; M: distant spread.</span>
            </PanelRow>
          )}
          {p.grade && <PanelRow term="Grade">{p.grade}</PanelRow>}
          {p.gleason && (
            <PanelRow term="Gleason">
              {p.gleason}
              <span className="t-faint block text-[11.5px] leading-snug">{GLEASON_NOTE}</span>
            </PanelRow>
          )}
          {p.treatments.length > 0 && <PanelRow term="Treatment">{p.treatments.join(', ')}</PanelRow>}
          {out && <PanelRow term="Outcome">{out}</PanelRow>}
          {p.priorCancers.length > 0 && <PanelRow term="Earlier cancer">{p.priorCancers.join('; ')}</PanelRow>}
        </dl>
        <p className="t-faint mt-3 text-[11px] leading-snug">
          De-identified research data from The Cancer Genome Atlas. No names, birth dates or hospital numbers were released.
        </p>
      </PanelSection>

      <PanelSection
        title={`Tumour mutations (${g.mutations.length})`}
        aside={<span>{g.mutationCount.toLocaleString()} found in all</span>}
      >
        {g.mutations.length === 0 ? (
          <p className="t-faint text-[12.5px]">
            {g.mutationCount === 0
              ? 'No mutation data has been published for this tumour.'
              : 'None of the protein-changing mutations is in a known cancer gene.'}
          </p>
        ) : (
          <>
            <p className="t-faint mb-3 text-[11.5px] leading-snug">
              Protein-changing changes in known cancer genes. {g.proteinChangingCount.toLocaleString()} of the {g.mutationCount.toLocaleString()} mutations change a protein.
            </p>
            <ul className="space-y-3">
              {mutations.map((m) => {
                const note = geneNote(m.gene);
                return (
                  <li key={`${m.gene}-${m.change}`} className="text-[12.5px]">
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold">{m.gene}</span>
                      <span className="t-mono">{m.change}</span>
                      <span className="t-faint ml-auto text-[11px]">{m.impact === 'high' ? 'disabling' : 'altering'}</span>
                    </div>
                    <p className="t-muted text-[11.5px] leading-snug">
                      <span className="font-medium">{note.name}.</span> {note.role}
                    </p>
                    <p className="t-faint text-[11px] leading-snug">{changeNote(m.gene, m.change, m.type)}</p>
                  </li>
                );
              })}
            </ul>
            {g.mutations.length > MUTATIONS_SHOWN && (
              <button type="button" className="link t-muted mt-3 text-[12px]" onClick={() => setAllMutations(!allMutations)}>
                {allMutations ? 'Show fewer' : `Show all ${g.mutations.length}`}
              </button>
            )}
          </>
        )}
      </PanelSection>

      {g.copyNumber && (
        <PanelSection title="Gene copies" aside={<span>{g.copyNumber.genesMeasured.toLocaleString()} genes measured</span>}>
          <div className="grid grid-cols-[1fr_auto] items-center gap-3 text-[12px]">
            <Bar value={g.copyNumber.fractionAltered * 100} />
            <span className="tabular-nums">{Math.round(g.copyNumber.fractionAltered * 100)}% of genes</span>
          </div>
          <p className="t-faint mt-1 text-[11.5px] leading-snug">
            Share of genes gained or lost compared with the rest of this tumour. A tidy genome stays near 0%; unstable
            tumours gain and lose whole chromosome arms.
            {g.copyNumber.ploidy > 2 &&
              ` Most genes here have ${g.copyNumber.ploidy} copies instead of 2: the tumour has duplicated much of its genome.`}
          </p>
          {amplified.length + deleted.length === 0 ? (
            <p className="t-faint mt-3 text-[12px]">
              No known cancer gene is amplified ({g.copyNumber.amplifiedFrom} or more copies) or fully deleted.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {[...amplified, ...deleted].slice(0, 12).map((c) => (
                <li key={c.gene} className="text-[12.5px]">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold">{c.gene}</span>
                    <span className={c.call === 'amplified' ? 't-accent' : 't-muted'}>
                      {c.call === 'amplified' ? `${c.copies} copies` : 'both copies lost'}
                    </span>
                    <span className="t-faint ml-auto text-[11px]">{c.chromosome?.replace('chr', 'chromosome ')}</span>
                  </div>
                  <p className="t-faint text-[11.5px] leading-snug">{geneNote(c.gene).role}</p>
                </li>
              ))}
              {amplified.length + deleted.length > 12 && (
                <li className="t-faint text-[11.5px]">and {g.copyNumber.callsTotal - 12} more</li>
              )}
            </ul>
          )}
        </PanelSection>
      )}

      {g.expression && g.expression.panel.length > 0 && (
        <PanelSection title="Gene activity" aside={<span>RNA sequencing</span>}>
          <p className="t-faint mb-3 text-[11.5px] leading-snug">
            How strongly the tumour reads each gene, ranked against all {g.expression.genesMeasured.toLocaleString()} of its
            protein-making genes. Genes chosen for this organ.
          </p>
          <ul className="space-y-2.5">
            {g.expression.panel.map((e) => (
              <li key={e.gene} className="text-[12.5px]" title={`${e.tpm} transcripts per million`}>
                <div className="grid grid-cols-[64px_1fr_64px] items-center gap-2">
                  <span className="font-semibold">{e.gene}</span>
                  <Bar value={e.percentile} />
                  <span className="text-right text-[11.5px] tabular-nums">
                    {e.percentile >= 50 ? `top ${Math.max(1, Math.round(100 - e.percentile))}%` : 'lower half'}
                  </span>
                </div>
                <p className="t-faint text-[11.5px] leading-snug">
                  <span className="t-muted">{geneNote(e.gene).name}.</span> {geneNote(e.gene).role}
                </p>
              </li>
            ))}
          </ul>
        </PanelSection>
      )}

      {image && (
        <PanelSection title="This section" aside={<span>{image.preparation === 'FFPE' ? 'FFPE' : 'Frozen'}</span>}>
          <p className="mb-2 text-[12.5px]">
            {image.label} <span className="t-faint t-mono text-[11px]">{image.barcode}</span>
          </p>
          <Composition image={image} />
        </PanelSection>
      )}

      {info.report && (
        <PanelSection title="Pathology report" aside={<span>{formatBytes(info.report.bytes)} PDF</span>}>
          <p className="t-muted text-[12.5px] leading-snug">
            The original report from the hospital, scanned with identifying details blacked out.
          </p>
          <div className="mt-3 flex gap-4 text-[12.5px]">
            {onOpenReport && (
              <button type="button" className="btn btn-ink" onClick={onOpenReport}>
                {reportOpen ? 'Report is open' : 'Open beside slide'}
              </button>
            )}
            <a href={info.report.sourceUrl} target="_blank" rel="noreferrer" className="link self-center">
              GDC record ↗
            </a>
          </div>
        </PanelSection>
      )}

      <PanelSection title="Also published for this patient">
        <ul className="space-y-2">
          {info.published.map((f) => (
            <li key={f.type} className="text-[12px]">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{f.type}</span>
                <span className="t-faint ml-auto whitespace-nowrap text-[11px]">
                  {f.files} {f.files === 1 ? 'file' : 'files'} · {formatBytes(f.bytes)}
                </span>
              </div>
              {PUBLISHED_NOTES[f.type] && <p className="t-faint text-[11.5px] leading-snug">{PUBLISHED_NOTES[f.type]}</p>}
            </li>
          ))}
        </ul>
        <a href={p.gdcCaseUrl} target="_blank" rel="noreferrer" className="link mt-3 inline-block text-[12.5px]">
          All files at the Genomic Data Commons ↗
        </a>
      </PanelSection>

      <PanelSection title="Sources">
        <p className="t-faint text-[11.5px] leading-snug">
          Patient record, genomics, report and slides: NCI Genomic Data Commons, TCGA open-access data. AI layers: NCI
          Imaging Data Commons, CC BY 4.0. The results shown here are in whole or part based upon data generated by the
          TCGA Research Network.
        </p>
      </PanelSection>
    </>
  );
}
