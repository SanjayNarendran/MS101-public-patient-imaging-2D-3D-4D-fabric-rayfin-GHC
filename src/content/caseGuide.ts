/**
 * Plain-language notes for the case information shown with TCGA slides: the patient record, staging,
 * tumour genes, the other slides from the same patient and the AI layers. Used by the Case tab, the
 * patient banner, the AI layer controls and the Guide tab. Genes without a note fall back to a generic line.
 */
import type { Term } from './guide';

export interface GeneNote {
  /** What the gene's protein is, in a few words. */
  name: string;
  /** What it does and why it matters in cancer. */
  role: string;
}

export const GENE_NOTES: Record<string, GeneNote> = {
  TP53: { name: 'p53, the “guardian of the genome”', role: 'Stops damaged cells from dividing. The most commonly broken gene in cancer; losing it lets damaged cells keep growing.' },
  KRAS: { name: 'KRAS growth switch', role: 'Passes “grow” signals inside the cell. Mutations jam it on. Common in bowel, lung and pancreatic cancer; some forms (such as G12C) now have targeted drugs.' },
  NRAS: { name: 'NRAS growth switch', role: 'A close relative of KRAS; mutations jam the growth signal on.' },
  BRAF: { name: 'BRAF growth switch', role: 'Relays “grow” signals. The V600E change, common in melanoma and thyroid cancer, can be blocked by targeted drugs.' },
  APC: { name: 'APC gatekeeper', role: 'Keeps bowel-lining cells in check. Losing it is usually the first step in bowel cancer.' },
  PIK3CA: { name: 'PI3K growth enzyme', role: 'Drives cell growth and survival. Mutated in many breast and bowel cancers; drugs target some forms.' },
  PTEN: { name: 'PTEN brake', role: 'The brake on the PI3K growth pathway; losing it lets cells grow unchecked.' },
  EGFR: { name: 'EGF receptor', role: 'A receptor on the cell surface that tells cells to grow. Mutated or amplified in some lung cancers and glioblastoma; several drugs target it.' },
  ERBB2: { name: 'HER2 receptor', role: 'A growth receptor. When there are too many copies (HER2-positive), drugs such as trastuzumab work well.' },
  ARID1A: { name: 'ARID1A DNA packager', role: 'Helps control which genes are switched on by packing DNA. Often lost in stomach, ovarian and bowel cancers.' },
  KEAP1: { name: 'KEAP1 stress sensor', role: 'Controls the cell’s response to chemical stress. Broken in some lung cancers, which can make them harder to treat.' },
  STK11: { name: 'LKB1 energy sensor', role: 'Links cell growth to energy supply; lost in some lung cancers.' },
  CDKN2A: { name: 'p16 cell-cycle brake', role: 'Stops cells from dividing too early. Often deleted or mutated in many cancers.' },
  CDKN2B: { name: 'p15 cell-cycle brake', role: 'A neighbour of p16 that is often deleted with it.' },
  RB1: { name: 'RB cell-cycle brake', role: 'The classic “retinoblastoma” brake on cell division.' },
  VHL: { name: 'VHL oxygen sensor', role: 'Tells cells how much oxygen there is. Losing it is the defining step in clear cell kidney cancer and makes tumours grow many blood vessels.' },
  PBRM1: { name: 'PBRM1 DNA packager', role: 'Helps pack DNA. The second most common change in clear cell kidney cancer, after VHL.' },
  SETD2: { name: 'SETD2 DNA marker', role: 'Marks DNA packaging; often lost in kidney cancer.' },
  BAP1: { name: 'BAP1 tumour suppressor', role: 'Repairs and tidies DNA proteins; loss is linked to more aggressive kidney cancer and melanoma of the eye.' },
  CDH1: { name: 'E-cadherin, cell glue', role: 'Holds cells together. Its loss is the hallmark of lobular breast cancer and diffuse stomach cancer, whose cells spread out in single files.' },
  FOXA1: { name: 'FOXA1 pioneer factor', role: 'Opens up DNA so the oestrogen receptor can work; common in hormone-sensitive breast and prostate cancers.' },
  GATA3: { name: 'GATA3 regulator', role: 'Steers breast cells to mature normally; mutated in some hormone-positive breast cancers.' },
  ESR1: { name: 'Oestrogen receptor', role: 'Lets cells respond to the hormone oestrogen. Oestrogen-receptor-positive breast cancers can be treated with hormone therapy.' },
  PGR: { name: 'Progesterone receptor', role: 'Responds to progesterone; a second sign that a breast cancer is hormone-driven.' },
  MKI67: { name: 'Ki-67 growth marker', role: 'Made only by dividing cells, so it measures how fast a tumour is growing.' },
  CD274: { name: 'PD-L1 “don’t attack” signal', role: 'Tells immune cells to stand down. High levels can mean immunotherapy is more likely to work.' },
  GFAP: { name: 'GFAP brain support-cell protein', role: 'Made by astrocytes, the brain’s support cells, and by tumours that come from them, such as glioblastoma.' },
  OLIG2: { name: 'OLIG2 brain-cell regulator', role: 'Marks glial cells and gliomas.' },
  SOX2: { name: 'SOX2 stem-cell factor', role: 'Keeps cells in a stem-like state; high in many brain tumours.' },
  'NKX2-1': { name: 'TTF-1 lung and thyroid factor', role: 'Marks cells of lung and thyroid origin; pathologists stain for it to confirm lung adenocarcinoma.' },
  NAPSA: { name: 'Napsin A', role: 'A lung-gland protein used to confirm lung adenocarcinoma.' },
  KRT5: { name: 'Keratin 5', role: 'A structural protein of squamous (flat, skin-like) cells; confirms squamous cell carcinoma.' },
  TP63: { name: 'p63 squamous-cell factor', role: 'Marks squamous and basal cells; used to confirm squamous cell carcinoma.' },
  CA9: { name: 'Carbonic anhydrase IX', role: 'Made when cells think they lack oxygen; very high in clear cell kidney cancer because VHL is lost.' },
  PAX8: { name: 'PAX8 kidney, thyroid and ovary factor', role: 'Marks cells of kidney, thyroid and ovarian (Müllerian) origin; used to work out where a tumour started.' },
  VIM: { name: 'Vimentin', role: 'A flexible scaffold protein of supporting cells; also made by kidney cancers.' },
  CDX2: { name: 'CDX2 bowel factor', role: 'Marks cells of intestinal origin; used to confirm a cancer started in the bowel.' },
  CEACAM5: { name: 'CEA', role: 'Carcinoembryonic antigen, a protein measured in the blood to follow bowel cancer.' },
  KRT20: { name: 'Keratin 20', role: 'A structural protein typical of bowel lining.' },
  PMEL: { name: 'PMEL pigment protein', role: 'Builds the pigment granules of melanocytes; marks melanoma.' },
  MLANA: { name: 'Melan-A', role: 'A pigment-cell protein used to confirm melanoma.' },
  TYR: { name: 'Tyrosinase', role: 'The enzyme that makes melanin pigment.' },
  SOX10: { name: 'SOX10 pigment-cell factor', role: 'Marks melanocytes and melanoma.' },
  CLDN18: { name: 'Claudin 18.2', role: 'A stomach-lining protein; a newer drug (zolbetuximab) targets it in stomach cancer.' },
  TG: { name: 'Thyroglobulin', role: 'The raw material of thyroid hormone, made only by thyroid cells; measured in blood after thyroid cancer treatment.' },
  TPO: { name: 'Thyroid peroxidase', role: 'The enzyme that makes thyroid hormone.' },
  KLK3: { name: 'PSA', role: 'Prostate-specific antigen, the protein measured in the PSA blood test.' },
  AR: { name: 'Androgen receptor', role: 'Responds to testosterone; prostate cancer depends on it, which is why hormone therapy works.' },
  'NKX3-1': { name: 'NKX3.1 prostate factor', role: 'Marks prostate cells; used to confirm prostate origin.' },
  FOLH1: { name: 'PSMA', role: 'Prostate-specific membrane antigen, targeted by PSMA PET scans and radioligand therapy.' },
  KRT19: { name: 'Keratin 19', role: 'A structural protein of duct-lining cells, typical of pancreatic cancer.' },
  MUC1: { name: 'MUC1 mucin', role: 'A slimy coat protein, over-made by many adenocarcinomas.' },
  MSLN: { name: 'Mesothelin', role: 'A surface protein high in pancreatic and ovarian cancers; a target of experimental therapies.' },
  WT1: { name: 'WT1 factor', role: 'Marks serous ovarian cancer and mesothelium.' },
  MUC16: { name: 'CA-125', role: 'The protein measured in the CA-125 blood test for ovarian cancer. As a mutation it is usually a passenger: the gene is huge, so it collects changes by chance.' },
  MYC: { name: 'MYC master growth switch', role: 'Drives cells to grow and divide; extra copies are common in many cancers.' },
  CCNE1: { name: 'Cyclin E1', role: 'Pushes cells into dividing; amplified in some ovarian and stomach cancers.' },
  MDM2: { name: 'MDM2', role: 'Switches off p53; extra copies disable p53 without mutating it.' },
  CDK4: { name: 'CDK4 cell-cycle engine', role: 'Drives the cell cycle; extra copies are seen in glioblastoma and some sarcomas, and drugs block it.' },
  PDGFRA: { name: 'PDGF receptor alpha', role: 'A growth receptor amplified in some glioblastomas.' },
  IDH1: { name: 'IDH1 metabolic enzyme', role: 'Mutations mark a slower-growing family of gliomas.' },
  NF1: { name: 'Neurofibromin', role: 'The off-switch for RAS growth signals.' },
  SMAD4: { name: 'SMAD4 signal relay', role: 'Relays growth-limiting signals; lost in many pancreatic and bowel cancers.' },
  CTNNB1: { name: 'Beta-catenin', role: 'A signal and cell-glue protein; mutations switch on growth genes.' },
  KMT2D: { name: 'KMT2D DNA marker', role: 'Marks DNA packaging to switch genes on; often broken in many cancers.' },
  KMT2C: { name: 'KMT2C DNA marker', role: 'A partner of KMT2D in switching genes on.' },
  NOTCH1: { name: 'NOTCH1 signal', role: 'Controls cell fate; acts as a tumour suppressor in squamous cancers.' },
  ATM: { name: 'ATM DNA-damage sensor', role: 'Detects broken DNA and triggers repair.' },
  BRCA1: { name: 'BRCA1 DNA repair', role: 'Repairs broken DNA; inherited faults raise breast and ovarian cancer risk.' },
  BRCA2: { name: 'BRCA2 DNA repair', role: 'Repairs broken DNA; inherited faults raise breast, ovarian and prostate cancer risk.' },
  SPOP: { name: 'SPOP protein recycler', role: 'Tags proteins for disposal; mutated in about one in ten prostate cancers.' },
  ERG: { name: 'ERG factor', role: 'Often fused to TMPRSS2 in prostate cancer, switching it on.' },
  CCND1: { name: 'Cyclin D1', role: 'Starts the cell cycle. Extra copies, common in hormone-positive breast cancer, push cells to divide; CDK4/6-blocking drugs counter it.' },
  JAK2: { name: 'JAK2 signal kinase', role: 'Relays signals from immune messengers. It sits right next to PD-L1 (CD274) on chromosome 9, so the two are often gained together.' },
  FBXW7: { name: 'FBXW7 protein recycler', role: 'Tags growth proteins such as MYC and cyclin E for destruction; when it is lost they pile up.' },
  ATR: { name: 'ATR DNA-damage sensor', role: 'Senses stalled DNA copying and pauses the cell to fix it.' },
  ALK: { name: 'ALK receptor', role: 'A growth receptor; rearranged in a few lung cancers, which then respond to ALK-blocking pills.' },
  MAP2K1: { name: 'MEK1 growth relay', role: 'The step after BRAF in the growth signal chain; MEK blockers are given with BRAF blockers in melanoma.' },
  ERBB3: { name: 'HER3 receptor', role: 'A partner of HER2 that boosts growth signalling.' },
  PIK3CB: { name: 'PI3K beta', role: 'A sister of PIK3CA in the PI3K growth pathway.' },
  ARID2: { name: 'ARID2 DNA packager', role: 'Helps pack DNA; often lost in melanoma and liver cancer.' },
  TCF7L2: { name: 'TCF4 bowel growth factor', role: 'Acts on the APC/beta-catenin pathway that drives most bowel cancers.' },
  CDK12: { name: 'CDK12 transcription kinase', role: 'Keeps DNA-repair genes switched on; its loss weakens DNA repair.' },
  NBN: { name: 'Nibrin DNA repair', role: 'Part of the team that repairs broken DNA.' },
  BCL3: { name: 'BCL3 regulator', role: 'Controls inflammation and survival genes.' },
  BCL11B: { name: 'BCL11B regulator', role: 'Guides how certain immune and brain cells mature.' },
  IKZF1: { name: 'Ikaros', role: 'A master regulator of blood and immune cell development.' },
  MUC4: { name: 'MUC4 mucin', role: 'A large surface mucin; like MUC16, it mutates often because the gene is huge.' },
  LRP1B: { name: 'LRP1B receptor', role: 'A very large gene that is often damaged in many cancers; its role is still debated.' },
  CSMD3: { name: 'CSMD3', role: 'A huge gene that collects mutations in smokers’ lung cancers; usually a passenger, not a driver.' },
  BRD4: { name: 'BRD4 reader', role: 'Reads DNA packaging marks to switch growth genes on; a target of experimental drugs.' },
  FLT4: { name: 'VEGFR3 receptor', role: 'Grows lymph vessels.' },
  EML4: { name: 'EML4', role: 'Best known as the partner in the EML4-ALK fusion found in some lung cancers.' },
  KMT2A: { name: 'KMT2A (MLL) DNA marker', role: 'Marks DNA packaging; rearranged in some leukaemias.' },
  CCDC6: { name: 'CCDC6', role: 'Best known as a fusion partner of RET in thyroid cancer.' },
  CHD4: { name: 'CHD4 DNA remodeller', role: 'Moves DNA packaging to repair damage and control genes.' },
  BCL11A: { name: 'BCL11A regulator', role: 'Controls blood-cell genes; amplified in some lung cancers.' },
  ARID1B: { name: 'ARID1B DNA packager', role: 'A partner of ARID1A in packing DNA.' },
  PIK3R1: { name: 'PI3K regulator', role: 'The brake part of the PI3K growth enzyme.' },
  SOX21: { name: 'SOX21 factor', role: 'A developmental gene that controls cell identity.' },
  AXIN2: { name: 'Axin 2', role: 'A brake on the beta-catenin pathway of bowel cancer.' },
  DCC: { name: 'DCC receptor', role: '“Deleted in colorectal cancer”: a receptor often lost in bowel cancer.' },
  BCL9L: { name: 'BCL9-like', role: 'Boosts beta-catenin signalling in bowel cancer.' },
  CDH10: { name: 'Cadherin 10', role: 'A cell-glue protein; a large gene often mutated in melanoma from sun damage.' },
  ARNT: { name: 'ARNT (HIF-1 beta)', role: 'A partner of the oxygen-sensing HIF proteins.' },
  CEBPA: { name: 'C/EBP alpha', role: 'Steers cells to mature; best known in leukaemia.' },
  HNRNPA2B1: { name: 'hnRNP A2/B1', role: 'Processes RNA messages.' },
  SMC1A: { name: 'SMC1A cohesin', role: 'Holds copied chromosomes together until a cell divides.' },
  PTPRD: { name: 'PTPRD phosphatase', role: 'A brake on growth signals, often lost in many cancers.' },
};

export function geneNote(gene: string): GeneNote {
  return GENE_NOTES[gene] ?? { name: gene, role: 'A gene on the Cancer Gene Census, the catalogue of genes known to drive cancer.' };
}

/** Explains protein changes such as `G12D`, `R805Dfs*15` or `K993*`. */
export function changeNote(gene: string, change: string, type: string): string {
  if (gene === 'BRAF' && change === 'V640E') return 'The well-known BRAF V600E change; the data numbers it on a longer version of the gene.';
  if (/fs\*/.test(change)) return 'A frameshift: letters were added or lost, so everything after this point is garbled and the protein is usually useless.';
  if (/\*$/.test(change)) return 'A stop signal appears early, so the protein is cut short and usually does not work.';
  if (/splice/.test(change) || /splice/.test(type)) return 'Hits the splice site, where the gene is cut and joined, so the protein is usually built wrongly.';
  const m = /^([A-Z])(\d+)([A-Z])$/.exec(change);
  if (m) return `One building block of the protein (number ${m[2]}) is swapped. Whether that matters depends on where it falls.`;
  return 'A change in the DNA code that alters the protein.';
}

export const STAGE_NOTES: Record<string, string> = {
  '0': 'Abnormal cells that have not invaded beyond where they started.',
  I: 'Small and confined to the organ where it started.',
  II: 'Larger, or starting to reach nearby tissue, but not widely spread.',
  III: 'Has spread to nearby lymph nodes or tissue around the organ.',
  IV: 'Has spread to distant parts of the body (metastasis), or for thyroid cancer, beyond the neck.',
};

export function stageNote(stage: string | null | undefined): string | null {
  const m = /Stage\s+(IV|III|II|I|0)/i.exec(stage ?? '');
  return m ? STAGE_NOTES[m[1].toUpperCase()] : null;
}

export const GLEASON_NOTE =
  'Prostate cancer’s grade: the two most common growth patterns, each scored 3 to 5, added together. 6 is low grade; 7 is intermediate, and 3 + 4 is the milder form of 7; 8 to 10 is high grade.';

export const TNM_NOTE =
  'TNM describes the cancer in three letters. T is the size and reach of the main tumour (T1 small, T4 large or invading nearby structures); N is spread to lymph nodes (N0 none); M is spread to distant organs (M0 none, M1 present, MX not assessed).';

export const CASE_TERMS: Term[] = [
  { term: 'Case', text: 'One patient in The Cancer Genome Atlas, identified only by a code such as TCGA-AC-A4ZE. Names, dates of birth and hospital numbers were removed before release; ages are given at diagnosis.' },
  { term: 'Patient banner', text: 'The strip above the slide, like the banner on a hospital imaging system: case code, sex, age at diagnosis, diagnosis, stage and the key gene changes. Click it for the full record in Details › Case.' },
  { term: 'Stage', text: 'How far the cancer had spread when it was found, from I (small and local) to IV (spread to distant organs). Stages can have letters, such as IIB, for finer steps.' },
  { term: 'TNM', text: TNM_NOTE },
  { term: 'Grade', text: 'How abnormal the cancer cells look: G1 close to normal, G3 or G4 very abnormal. Higher grades tend to grow faster.' },
  { term: 'Outcome', text: 'Whether the patient was alive at the last contact recorded by the study, and how long after diagnosis that was. Research follow-up often stops after a few years.' },
  { term: 'Mutation', text: 'A change in the DNA letters of the tumour that was not in the patient’s normal cells. The Case tab lists the protein-changing ones in known cancer genes.' },
  { term: 'Copy number', text: 'Normal cells carry two copies of each gene. Tumours often gain extra copies (amplification, shown here from 6 copies) or lose both (deletion). Extra copies of a growth gene act like turning up its volume.' },
  { term: 'Gene activity', text: 'How strongly each gene is being read in the tumour, measured by RNA sequencing. The bar shows where the gene ranks among the tumour’s 19,000 or so protein-making genes: 95th percentile means more active than 95 percent of them.' },
  { term: 'Slides from this patient', text: 'The filmstrip under the slide. Besides the diagnostic slide, most patients have frozen sections cut from the top and bottom of the sample used for DNA and RNA sequencing, and some have normal tissue for comparison.' },
  { term: 'Diagnostic slide (FFPE)', text: 'Tissue preserved in formalin and set in paraffin wax: the best-looking slides, used for diagnosis.' },
  { term: 'Frozen section', text: 'Tissue frozen and cut quickly. It looks rougher, with ice-crystal cracks, but it comes from the exact piece that was sequenced, so it shows what the genetic results are from.' },
  { term: 'Normal tissue', text: 'Healthy tissue from the same organ and patient, for comparing normal and cancer side by side.' },
  { term: 'Section composition', text: 'A pathologist’s estimate of what a section contains: the share of tumour cells, normal cells, supporting tissue (stroma), dead tissue (necrosis) and immune cells.' },
  { term: 'Compare', text: 'Shows a second slide next to the first. Link views moves both together; pick the same slide on both sides with AI layers on one side to see exactly what the AI marked.' },
  { term: 'Report', text: 'The original pathology report, scanned and with identifying details removed, shown beside the slide like in a hospital system. Some are typed, some handwritten.' },
];

export interface OverlayNote {
  name: string;
  short: string;
  shows: string;
  how: string;
  legend: { color: string; label: string }[];
  source: string;
  citation: string;
  license: string;
  url: string;
}

export const OVERLAY_NOTES: Record<string, OverlayNote> = {
  nuclei: {
    name: 'Nuclei (AI)',
    short: 'Every cell nucleus outlined by an AI model',
    shows: 'A cyan outline around every cell nucleus that an AI model found. Zoomed out, the outlines blend into a tint that shows where cells are crowded.',
    how: 'A deep-learning segmentation model, trained on pathologist-drawn examples, traced the nuclei on the whole slide. Counting, sizing and shaping nuclei is the first step of most computer-aided pathology.',
    legend: [{ color: '#19e3ff', label: 'Nucleus outline' }],
    source: 'Pan-Cancer-Nuclei-Seg, Stony Brook University, via the NCI Imaging Data Commons',
    citation: 'Hou L. et al. Dataset of segmented nuclei in hematoxylin and eosin stained histopathology images of ten cancer types. Scientific Data 7, 185 (2020).',
    license: 'CC BY 4.0',
    url: 'https://doi.org/10.7937/tcia.2019.4a4dkp9u',
  },
  til: {
    name: 'Immune cells (AI)',
    short: 'Where immune cells have moved into the tumour',
    shows: 'A heat map of tumour-infiltrating lymphocytes (TILs): immune cells that have moved into the tissue. Each square is 50 × 50 µm; yellow is possible, red is very likely.',
    how: 'A deep-learning classifier looked at every 50 µm patch of the slide and estimated the chance it holds immune cells. Tumours rich in TILs often have a better outlook and respond better to immunotherapy.',
    legend: [
      { color: '#ffd600', label: 'Possible' },
      { color: '#ff7a00', label: 'Likely' },
      { color: '#e6143c', label: 'Very likely' },
    ],
    source: 'TCGA TIL maps, Stony Brook University, via the NCI Imaging Data Commons',
    citation: 'Saltz J. et al. Spatial organization and molecular correlation of tumor-infiltrating lymphocytes using deep learning on pathology images. Cell Reports 23, 181 (2018); Abousamra S. et al. Frontiers in Oncology (2022).',
    license: 'CC BY 4.0',
    url: 'https://doi.org/10.7937/K9/TCIA.2018.Y75F9W1',
  },
};

export const AI_BASICS =
  'AI layers are published research results from computer models, drawn on top of the slide. They are shown to illustrate what computer-aided pathology looks like; they were not checked by a pathologist for these slides and are not a diagnosis.';

/** What each kind of GDC file holds, for the "Also published" list. */
export const PUBLISHED_NOTES: Record<string, string> = {
  'Slide Image': 'Scanned microscope slides (all shown in the filmstrip).',
  'Pathology Report': 'The scanned pathology report.',
  'Clinical Supplement': 'The full clinical record as submitted by the hospital.',
  'Biospecimen Supplement': 'Details of each tissue sample, slide and DNA/RNA extract.',
  'Masked Somatic Mutation': 'The tumour’s mutations (the list on this tab), with germline variants removed.',
  'Gene Level Copy Number': 'Copies of every gene in the tumour.',
  'Copy Number Segment': 'Stretches of chromosome gained or lost.',
  'Masked Copy Number Segment': 'As above, with inherited variants removed.',
  'Allele-specific Copy Number Segment': 'Gains and losses for each parent’s copy separately.',
  'Gene Expression Quantification': 'How active each of about 60,000 genes is (RNA sequencing).',
  'Isoform Expression Quantification': 'Activity of each version of each microRNA.',
  'miRNA Expression Quantification': 'Activity of microRNAs, small RNAs that fine-tune genes.',
  'Methylation Beta Value': 'Chemical tags on DNA that silence genes, at about 450,000 sites.',
  'Masked Intensities': 'Raw signal from the methylation chip.',
  'Raw Intensities': 'Raw signal from the methylation chip.',
  'Protein Expression Quantification': 'Levels of about 200 proteins, measured with antibodies (RPPA).',
};

export const COMPOSITION_LABELS: Record<string, string> = {
  tumourCells: 'Tumour cells',
  normalCells: 'Normal cells',
  stroma: 'Stroma',
  necrosis: 'Necrosis',
  lymphocytes: 'Lymphocytes',
  monocytes: 'Monocytes',
  neutrophils: 'Neutrophils',
};
