"""Case context for the TCGA H&E slides: the patient record, tumour genomics, the pathology report, every other
slide from the same patient and the public AI overlays, all from open-access sources.

Stages (run in order; each is re-runnable and skips finished work):

    python pipeline/build_cases.py fetch      # GDC metadata, report PDF, genomics files, other slides (SVS)
    python pipeline/build_cases.py tile       # DZI pyramids for the other slides
    python pipeline/build_cases.py overlays   # IDC AI overlays: nucleus outlines (tiled PNG) + immune-cell maps
    python pipeline/build_cases.py assemble   # writes slides/<id>/case.json, merged into the manifest
    python pipeline/generate_tiles.py --only none   # rebuild manifest.json

Sources and licences
  - NCI Genomic Data Commons, TCGA open-access tier (clinical, biospecimen, mutations, copy number, expression,
    pathology reports, slides). NIH Genomic Data Sharing policy; open tier, no restrictions on use.
  - NCI Imaging Data Commons: Pan-Cancer-Nuclei-Seg (Hou et al. 2020, Sci Data) and TCGA TIL maps (Saltz et al.
    2018, Cell Reports; Abousamra et al. 2022), both CC BY 4.0.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import math
import multiprocessing as mp
import os
import pathlib
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent
WORK = ROOT / "work"
CASES = WORK / "cases"
RAW_CASE = WORK / "raw" / "cases"
OUT = WORK / "lakehouse"
GDC = "https://api.gdc.cancer.gov/"

# Genes worth explaining for each organ: what pathologists and oncologists look at first.
EXPRESSION_PANEL = {
    "Brain": ["GFAP", "OLIG2", "EGFR", "SOX2", "MKI67", "CD274"],
    "Lung": ["NKX2-1", "NAPSA", "KRT5", "TP63", "EGFR", "MKI67", "CD274"],
    "Kidney": ["CA9", "PAX8", "VIM", "MKI67", "CD274"],
    "Colon": ["CDX2", "CEACAM5", "KRT20", "MKI67", "CD274"],
    "Rectum": ["CDX2", "CEACAM5", "KRT20", "MKI67", "CD274"],
    "Breast": ["ESR1", "PGR", "ERBB2", "GATA3", "CDH1", "MKI67", "CD274"],
    "Skin": ["PMEL", "MLANA", "TYR", "SOX10", "MKI67", "CD274"],
    "Stomach": ["CDX2", "CDH1", "ERBB2", "CLDN18", "MKI67", "CD274"],
    "Thyroid": ["TG", "TPO", "PAX8", "NKX2-1", "MKI67", "CD274"],
    "Prostate": ["KLK3", "AR", "NKX3-1", "FOLH1", "MKI67", "CD274"],
    "Pancreas": ["KRT19", "MUC1", "CEACAM5", "MSLN", "MKI67", "CD274"],
    "Ovary": ["PAX8", "WT1", "MUC16", "TP53", "MKI67", "CD274"],
}
AMPLIFIED = 6  # minimum absolute copies; a normal cell has 2 (raised to over twice the tumour's ploidy)
# Well-known cancer drivers, listed first in the Case tab.
HEADLINE_GENES = {
    "TP53", "KRAS", "NRAS", "BRAF", "APC", "PIK3CA", "PTEN", "EGFR", "ERBB2", "ARID1A", "KEAP1", "STK11", "CDKN2A",
    "RB1", "VHL", "PBRM1", "SETD2", "BAP1", "CDH1", "FOXA1", "GATA3", "IDH1", "NF1", "SMAD4", "CTNNB1", "FBXW7",
    "BRCA1", "BRCA2", "ATM", "MAP2K1", "SPOP", "ERBB3", "PIK3CB", "NOTCH1", "KMT2D", "ARID2", "TCF7L2",
}
SECTION = {"TOP": "top", "BOTTOM": "bottom", "MIDDLE": "middle"}
SAMPLE = {"01": "Tumour", "02": "Recurrent tumour", "06": "Metastasis", "10": "Normal blood", "11": "Normal tissue"}


# --------------------------------------------------------------------------------------------- GDC helpers
def gdc(endpoint: str, filters: dict, fields: str, size: int = 2000, expand: str | None = None) -> list[dict]:
    params = {"filters": json.dumps(filters), "fields": fields, "size": size, "format": "json"}
    if expand:
        params["expand"] = expand
    url = GDC + endpoint + "?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return json.load(r)["data"]["hits"]
        except Exception:
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))
    return []


def eq(field: str, value) -> dict:
    return {"op": "=" if not isinstance(value, list) else "in", "content": {"field": field, "value": value}}


def both(*ops: dict) -> dict:
    return {"op": "and", "content": list(ops)}


def download(file_id: str, dest: pathlib.Path) -> pathlib.Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(4):
        try:
            urllib.request.urlretrieve(GDC + "data/" + file_id, tmp)
            break
        except Exception:
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))
    tmp.rename(dest)
    return dest


def tcga_slides() -> list[dict]:
    return [s for s in json.loads((HERE / "slides.json").read_text()) if s.get("case", "").startswith("TCGA-")]


def barcode(file_name: str) -> str:
    return file_name.split(".")[0]


def slide_key(code: str) -> str:
    """`TCGA-57-1994-11A-01-TS1` -> `11a-ts1`."""
    parts = code.split("-")
    return f"{parts[3]}-{parts[5]}".lower()


def slide_label(code: str, section: str | None) -> tuple[str, str, str]:
    """Returns (label, sample type, preparation) for a TCGA slide barcode."""
    parts = code.split("-")
    sample = SAMPLE.get(parts[3][:2], "Sample")
    kind = parts[5]
    if kind.startswith("DX"):
        n = kind[2:]
        return (f"Diagnostic slide {n}" if sample == "Tumour" else f"{sample}, diagnostic {n}", sample, "FFPE")
    # The barcode (TS = top, BS = bottom, MS = middle section) is more reliable than the section field.
    where = {"TS": "top", "BS": "bottom", "MS": "middle"}.get(kind[:2]) or SECTION.get((section or "").upper(), "")
    n = kind[2:]
    label = f"{sample}, frozen {where}".strip() + (f" {n}" if n.isdigit() and n != "1" else "")
    return (label, sample, "Frozen")


# --------------------------------------------------------------------------------------------- fetch
def fetch_case(slide: dict) -> str:
    case = slide["case"]
    cdir = CASES / slide["id"]
    cdir.mkdir(parents=True, exist_ok=True)

    clinical = gdc(
        "cases",
        eq("submitter_id", case),
        "submitter_id,case_id,primary_site,disease_type,project.project_id,project.name",
        expand="demographic,diagnoses,diagnoses.treatments,follow_ups",
    )
    files = gdc(
        "files",
        both(eq("cases.submitter_id", case), eq("access", "open")),
        "file_id,file_name,file_size,data_type,data_category,data_format,experimental_strategy,analysis.workflow_type,"
        "cases.samples.sample_type,cases.samples.submitter_id",
    )
    slides = gdc(
        "files",
        both(eq("cases.submitter_id", case), eq("data_type", "Slide Image")),
        "file_id,file_name,file_size,cases.samples.sample_type,cases.samples.portions.slides.submitter_id,"
        "cases.samples.portions.slides.section_location,cases.samples.portions.slides.percent_tumor_cells,"
        "cases.samples.portions.slides.percent_tumor_nuclei,cases.samples.portions.slides.percent_normal_cells,"
        "cases.samples.portions.slides.percent_necrosis,cases.samples.portions.slides.percent_stromal_cells,"
        "cases.samples.portions.slides.percent_lymphocyte_infiltration,"
        "cases.samples.portions.slides.percent_monocyte_infiltration,"
        "cases.samples.portions.slides.percent_neutrophil_infiltration",
    )
    mutations = gdc(
        "ssm_occurrences",
        both(eq("case.submitter_id", case), eq("ssm.consequence.transcript.is_canonical", "true")),
        "ssm.ssm_id,ssm.genomic_dna_change,ssm.mutation_subtype,"
        "ssm.consequence.transcript.is_canonical,ssm.consequence.transcript.aa_change,"
        "ssm.consequence.transcript.consequence_type,ssm.consequence.transcript.annotation.vep_impact,"
        "ssm.consequence.transcript.annotation.polyphen_impact,ssm.consequence.transcript.annotation.sift_impact,"
        "ssm.consequence.transcript.gene.symbol,ssm.consequence.transcript.gene.is_cancer_gene_census",
        size=10000,
    )
    (cdir / "gdc.json").write_text(json.dumps({"case": clinical, "files": files, "slides": slides, "mutations": mutations}, indent=1))

    # Pathology report, gene-level copy number and gene expression: small files, worth keeping whole.
    def pick(data_type: str, prefer: str | None = None) -> dict | None:
        hits = [f for f in files if f["data_type"] == data_type and (f.get("cases") or [{}])[0].get("samples", [{}])[0].get("sample_type", "").startswith("Primary")]
        hits = hits or [f for f in files if f["data_type"] == data_type]
        if prefer:
            hits.sort(key=lambda f: prefer not in (f.get("analysis") or {}).get("workflow_type", ""))
        return hits[0] if hits else None

    got = []
    for data_type, name, prefer in (
        ("Pathology Report", "report.pdf", None),
        ("Gene Level Copy Number", "copy_number.tsv", "ASCAT3"),
        ("Gene Expression Quantification", "expression.tsv", None),
    ):
        f = pick(data_type, prefer)
        if f:
            download(f["file_id"], cdir / name)
            (cdir / f"{name}.meta.json").write_text(json.dumps(f, indent=1))
            got.append(name)

    main = barcode(slide["file"])
    extra = [s for s in slides if barcode(s["file_name"]) != main]
    for s in extra:
        download(s["file_id"], RAW_CASE / s["file_name"])
    return f"{slide['id']}: {', '.join(got)}; {len(extra)} other slides"


def cmd_fetch(args) -> None:
    slides = [s for s in tcga_slides() if not args.only or s["id"] in args.only]
    with ThreadPoolExecutor(4) as pool:
        for msg in pool.map(fetch_case, slides):
            print(msg, flush=True)


# --------------------------------------------------------------------------------------------- tile
def cmd_tile(args) -> None:
    import openslide
    from openslide.deepzoom import DeepZoomGenerator

    import generate_tiles as gt

    for slide in tcga_slides():
        if args.only and slide["id"] not in args.only:
            continue
        data = json.loads((CASES / slide["id"] / "gdc.json").read_text())
        main = barcode(slide["file"])
        for s in data["slides"]:
            code = barcode(s["file_name"])
            if code == main:
                continue
            key = slide_key(code)
            sdir = OUT / "slides" / slide["id"] / "case" / key
            info = sdir / "image.json"
            if info.exists() and not args.force:
                continue
            src = RAW_CASE / s["file_name"]
            osr = openslide.OpenSlide(str(src))
            dz = DeepZoomGenerator(osr, gt.TILE_SIZE, gt.OVERLAP, limit_bounds=True)
            files = sdir / "slide_files"
            jobs = []
            for level in range(dz.level_count):
                (files / str(level)).mkdir(parents=True, exist_ok=True)
                cols, rows = dz.level_tiles[level]
                jobs += [(level, c, r, str(files / str(level) / f"{c}_{r}.jpg")) for c in range(cols) for r in range(rows)]
            t0 = time.time()
            with mp.Pool(args.workers, initializer=gt._init, initargs=(str(src),)) as pool:
                pool.map(gt._write, jobs, chunksize=32)
            (sdir / "slide.dzi").write_text(dz.get_dzi("jpg"))
            thumb_level = max(i for i, t in enumerate(dz.level_tiles) if t == (1, 1))
            thumb = gt.whiten(dz.get_tile(thumb_level, (0, 0)).convert("RGB"))
            thumb.save(sdir / "thumbnail.jpg", "JPEG", quality=88)
            props = osr.properties
            mpp = props.get(openslide.PROPERTY_NAME_MPP_X)
            width, height = dz.level_dimensions[-1]
            info.write_text(json.dumps({
                "width": width,
                "height": height,
                "levels": dz.level_count,
                "tileSize": gt.TILE_SIZE,
                "overlap": gt.OVERLAP,
                "format": "jpg",
                "tileCount": len(jobs),
                "tilesBytes": sum(os.path.getsize(j[3]) for j in jobs),
                "objectivePower": float(props.get(openslide.PROPERTY_NAME_OBJECTIVE_POWER) or 0) or None,
                "mpp": float(mpp) if mpp else None,
                "hotspots": gt.find_hotspots(thumb),
                "rawSizeBytes": src.stat().st_size,
            }, indent=1))
            print(f"{slide['id']}/{key}: {width}x{height}, {len(jobs)} tiles in {time.time() - t0:.0f}s", flush=True)


# --------------------------------------------------------------------------------------------- overlays
NUCLEI_COLOR = (25, 227, 255)
TIL_RAMP = [(0.0, (255, 214, 0)), (0.5, (255, 122, 0)), (1.0, (230, 20, 60))]


def idc_rows(cases: list[str]) -> list[dict]:
    from idc_index import IDCClient

    c = IDCClient()
    for n in ("seg_index", "sm_index"):
        c.fetch_index(n)
    ids = ",".join(f"'{x}'" for x in cases)
    df = c.sql_query(f"""
        select i.PatientID as patient, i.analysis_result_id as result, i.SeriesInstanceUID as uid,
               i.SeriesDescription as description, i.series_size_MB as mb, s.SegmentationType as segtype,
               sm.ContainerIdentifier as slide
        from index i join seg_index s on s.SeriesInstanceUID = i.SeriesInstanceUID
        join sm_index sm on sm.SeriesInstanceUID = s.segmented_SeriesInstanceUID
        where i.PatientID in ({ids}) and i.Modality = 'SEG'
          and (i.analysis_result_id = 'pan_cancer_nuclei_seg_dicom'
               or (i.analysis_result_id = 'tcga_sbu_til_maps' and s.SegmentationType = 'FRACTIONAL'))""")
    return df.to_dict("records"), c


def nuclei_count(client, slide_code: str) -> int | None:
    """Number of nuclei polygons in the matching Pan-Cancer-Nuclei-Seg annotation (ANN) object."""
    try:
        client.fetch_index("ann_group_index")
        client.fetch_index("ann_index")
        df = client.sql_query(f"""
            select sum(g.NumberOfAnnotations) as n from index i
            join ann_index a on a.SeriesInstanceUID = i.SeriesInstanceUID
            join ann_group_index g on g.SeriesInstanceUID = i.SeriesInstanceUID
            join sm_index sm on sm.SeriesInstanceUID = a.referenced_SeriesInstanceUID
            where sm.ContainerIdentifier = '{slide_code}' and i.analysis_result_id = 'pan_cancer_nuclei_seg_dicom'""")
        n = df["n"].iloc[0]
        return int(n) if n == n and n else None
    except Exception as error:  # the count is a nicety; the overlay works without it
        print("nuclei count unavailable:", error)
        return None


def full_res_seg(series_dir: pathlib.Path):
    import pydicom

    best = None
    for f in series_dir.glob("*.dcm"):
        d = pydicom.dcmread(f, stop_before_pixels=True)
        cols = int(d.TotalPixelMatrixColumns)
        if best is None or cols > best[1]:
            best = (f, cols)
    return best[0] if best else None


def render_til(dcm: pathlib.Path, dest: pathlib.Path, slide_mpp: float) -> dict:
    """Fractional TIL probability (0-255 per 50 µm patch) -> RGBA heat map PNG, plus its size in slide pixels."""
    import pydicom

    d = pydicom.dcmread(dcm)
    prob = d.pixel_array.astype(np.float32) / float(d.get("MaximumFractionalValue", 255))
    if prob.ndim == 3:
        prob = prob[0]
    spacing_mm = float(d.SharedFunctionalGroupsSequence[0].PixelMeasuresSequence[0].PixelSpacing[0])
    rgba = np.zeros(prob.shape + (4,), np.uint8)
    for i in range(3):
        xs = [p for p, _ in TIL_RAMP]
        rgba[..., i] = np.interp(prob, xs, [c[i] for _, c in TIL_RAMP]).astype(np.uint8)
    # Patches below 15% are transparent; above, opacity grows with probability.
    rgba[..., 3] = np.where(prob < 0.15, 0, np.clip(60 + prob * 195, 0, 255)).astype(np.uint8)
    scale = 4  # nearest-neighbour upscale keeps the patch grid crisp when the browser smooths it
    img = Image.fromarray(rgba, "RGBA").resize((prob.shape[1] * scale, prob.shape[0] * scale), Image.NEAREST)
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, optimize=True)
    width_px = prob.shape[1] * spacing_mm * 1000 / slide_mpp
    return {
        "width": round(width_px, 1),
        "patchUm": round(spacing_mm * 1000, 1),
        "patches": int(prob.size),
        "positivePatches": int((prob >= 0.5).sum()),
        "tissuePatches": int((prob > 0).sum()),
        "bytes": dest.stat().st_size,
    }


_mask: np.memmap | None = None
# Tiles with nothing to draw are written as a 1x1 transparent PNG so the viewer never requests a missing file.
_EMPTY = io.BytesIO()
Image.new("RGBA", (1, 1)).save(_EMPTY, "PNG")
EMPTY_PNG = _EMPTY.getvalue()


def _empty(dest: str) -> int:
    with open(dest, "wb") as f:
        f.write(EMPTY_PNG)
    return 0


def _outline_tile(job) -> int:
    level, col, row, scale, tile, overlap, dest = job
    h, w = _mask.shape
    x0 = max(col * tile - overlap, 0) * scale
    y0 = max(row * tile - overlap, 0) * scale
    x1 = min((col + 1) * tile + overlap, math.ceil(w / scale)) * scale
    y1 = min((row + 1) * tile + overlap, math.ceil(h / scale)) * scale
    x1, y1 = min(x1, w), min(y1, h)
    if x1 <= x0 or y1 <= y0:
        return _empty(dest)
    if scale <= 4:
        # Trace outlines at full resolution (padded so edges between tiles are traced correctly), then keep any
        # outline pixel when shrinking, so 10x and 20x views still show thin outlines rather than filled blobs.
        px0, py0, px1, py1 = max(x0 - 1, 0), max(y0 - 1, 0), min(x1 + 1, w), min(y1 + 1, h)
        m = np.asarray(_mask[py0:py1, px0:px1]) > 0
        inner = m.copy()
        inner[1:-1, 1:-1] = m[1:-1, 1:-1] & m[:-2, 1:-1] & m[2:, 1:-1] & m[1:-1, :-2] & m[1:-1, 2:]
        edge = (m & ~inner)[y0 - py0 : y0 - py0 + (y1 - y0), x0 - px0 : x0 - px0 + (x1 - x0)]
        if scale > 1:
            hh, ww = math.ceil(edge.shape[0] / scale) * scale, math.ceil(edge.shape[1] / scale) * scale
            padded = np.zeros((hh, ww), bool)
            padded[: edge.shape[0], : edge.shape[1]] = edge
            edge = padded.reshape(hh // scale, scale, ww // scale, scale).any(axis=(1, 3))
        alpha = edge.astype(np.uint8) * 255
        if not alpha.any():
            return _empty(dest)
    else:
        # Lower levels: nucleus density as a soft tint (outlines would be sub-pixel).
        block = np.asarray(_mask[y0:y1:max(1, scale // 8), x0:x1:max(1, scale // 8)]) > 0
        step = min(8, scale)
        hh, ww = (block.shape[0] // step) * step, (block.shape[1] // step) * step
        if hh == 0 or ww == 0:
            return _empty(dest)
        dens = block[:hh, :ww].reshape(hh // step, step, ww // step, step).mean(axis=(1, 3))
        alpha = np.clip(dens * 170, 0, 100).astype(np.uint8)
        out_h, out_w = math.ceil((y1 - y0) / scale), math.ceil((x1 - x0) / scale)
        alpha = np.asarray(Image.fromarray(alpha).resize((out_w, out_h), Image.BILINEAR))
        if alpha.max() < 8:
            return _empty(dest)
    rgba = np.zeros(alpha.shape + (4,), np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = NUCLEI_COLOR
    rgba[..., 3] = alpha
    Image.fromarray(rgba, "RGBA").save(dest, optimize=True)
    return 1


def _init_mask(path: str, shape: tuple[int, int]) -> None:
    global _mask
    _mask = np.memmap(path, dtype=np.uint8, mode="r", shape=shape)


def render_nuclei(dcm: pathlib.Path, outdir: pathlib.Path, width: int, height: int, workers: int) -> dict:
    """Binary full-resolution nuclei SEG (TILED_FULL, 1 bit per pixel) -> transparent PNG Deep Zoom pyramid."""
    import pydicom

    from generate_tiles import OVERLAP, TILE_SIZE

    d = pydicom.dcmread(dcm)
    rows, cols = int(d.Rows), int(d.Columns)
    tw, th = int(d.TotalPixelMatrixColumns), int(d.TotalPixelMatrixRows)
    if (tw, th) != (width, height):
        raise ValueError(f"nuclei mask {tw}x{th} does not match slide {width}x{height}")
    n_cols, n_rows = math.ceil(tw / cols), math.ceil(th / rows)
    frames = int(d.NumberOfFrames)
    assert frames == n_cols * n_rows, (frames, n_cols, n_rows)
    bits = np.unpackbits(np.frombuffer(d.PixelData, np.uint8), bitorder="little")
    per = rows * cols
    mask_path = outdir.parent / "nuclei.mask"
    outdir.mkdir(parents=True, exist_ok=True)
    mask = np.memmap(mask_path, dtype=np.uint8, mode="w+", shape=(th, tw))
    for i in range(frames):
        r, c = divmod(i, n_cols)
        tile = bits[i * per : (i + 1) * per].reshape(rows, cols)
        y, x = r * rows, c * cols
        hh, ww = min(rows, th - y), min(cols, tw - x)
        mask[y : y + hh, x : x + ww] = tile[:hh, :ww]
    mask.flush()
    del bits, d

    max_level = math.ceil(math.log2(max(tw, th)))
    jobs = []
    for level in range(max_level + 1):
        scale = 2 ** (max_level - level)
        lw, lh = math.ceil(tw / scale), math.ceil(th / scale)
        if scale > 64:
            continue  # below ~1x the outlines and tint are invisible; OpenSeadragon falls back gracefully
        ldir = outdir / "slide_files" / str(level)
        ldir.mkdir(parents=True, exist_ok=True)
        for col in range(math.ceil(lw / TILE_SIZE)):
            for row in range(math.ceil(lh / TILE_SIZE)):
                jobs.append((level, col, row, scale, TILE_SIZE, OVERLAP, str(ldir / f"{col}_{row}.png")))
    with mp.Pool(workers, initializer=_init_mask, initargs=(str(mask_path), (th, tw))) as pool:
        written = sum(pool.imap_unordered(_outline_tile, jobs, chunksize=16))
    os.remove(mask_path)
    min_level = max_level - 6
    (outdir / "slide.dzi").write_text(
        f'<?xml version="1.0" encoding="UTF-8"?><Image xmlns="http://schemas.microsoft.com/deepzoom/2008" '
        f'Format="png" Overlap="{OVERLAP}" TileSize="{TILE_SIZE}"><Size Height="{th}" Width="{tw}"/></Image>'
    )
    size = sum(f.stat().st_size for f in (outdir / "slide_files").rglob("*.png"))
    return {"minLevel": min_level, "levels": max_level + 1, "tileCount": len(jobs), "drawnTiles": written, "tilesBytes": size}


def cmd_overlays(args) -> None:
    from generate_tiles import TILE_SIZE

    slides = [s for s in tcga_slides() if not args.only or s["id"] in args.only]
    rows, client = idc_rows([s["case"] for s in slides])
    idc_dir = WORK / "overlays" / "idc"
    by_slide: dict[str, list[dict]] = {}
    for r in rows:
        by_slide.setdefault(r["slide"], []).append(r)

    for slide in slides:
        data = json.loads((CASES / slide["id"] / "gdc.json").read_text())
        main = barcode(slide["file"])
        targets = [(main, OUT / "slides" / slide["id"])]
        for s in data["slides"]:
            code = barcode(s["file_name"])
            if code != main:
                targets.append((code, OUT / "slides" / slide["id"] / "case" / slide_key(code)))
        for code, sdir in targets:
            found = by_slide.get(code, [])
            if not found:
                continue
            info_path = sdir / ("label.json" if sdir.name == slide["id"] else "image.json")
            info = json.loads(info_path.read_text())
            missing = [r["uid"] for r in found if not any((idc_dir / r["patient"] / r["uid"]).glob("*.dcm"))]
            if missing:
                client.download_from_selection(
                    seriesInstanceUID=missing, downloadDir=str(idc_dir),
                    dirTemplate="%PatientID/%SeriesInstanceUID", quiet=True,
                )
            overlays = []
            for r in found:
                series = idc_dir / r["patient"] / r["uid"]
                if r["result"] == "tcga_sbu_til_maps":
                    dest = sdir / "overlays" / "til.png"
                    meta = render_til(next(series.glob("*.dcm")), dest, info["mpp"])
                    overlays.append({"id": "til", "kind": "image", "file": "overlays/til.png", "seriesUid": r["uid"], **meta})
                else:
                    odir = sdir / "overlays" / "nuclei"
                    meta_path = odir / "meta.json"
                    if meta_path.exists() and not args.force:
                        meta = json.loads(meta_path.read_text())
                    else:
                        t0 = time.time()
                        meta = render_nuclei(full_res_seg(series), odir, info["width"], info["height"], args.workers)
                        meta["count"] = nuclei_count(client, code)
                        meta_path.write_text(json.dumps(meta))
                        print(f"  nuclei {code}: {meta['drawnTiles']}/{meta['tileCount']} tiles, {meta['tilesBytes'] / 1e6:.0f} MB in {time.time() - t0:.0f}s", flush=True)
                    overlays.append({
                        "id": "nuclei", "kind": "tiled", "prefix": "overlays/nuclei/", "format": "png",
                        "tileSize": TILE_SIZE, "seriesUid": r["uid"], **meta,
                    })
            (sdir / "overlays.json").write_text(json.dumps(sorted(overlays, key=lambda o: o["id"]), indent=1))
            print(f"{slide['id']} {code}: {', '.join(o['id'] for o in overlays)}", flush=True)


# --------------------------------------------------------------------------------------------- assemble
def years(days) -> float | None:
    return round(days / 365.25, 1) if isinstance(days, (int, float)) else None


def clean(value):
    if value in (None, "", "not reported", "Not Reported", "Unknown", "unknown", "Not Applicable", "not applicable"):
        return None
    return value


def read_tsv(path: pathlib.Path) -> list[dict]:
    text = path.read_bytes()
    if text[:2] == b"\x1f\x8b":
        text = gzip.decompress(text)
    lines = [ln for ln in text.decode().splitlines() if not ln.startswith("#")]
    return list(csv.DictReader(lines, delimiter="\t"))


def cancer_genes() -> set[str]:
    cache = WORK / "cases" / "cancer_gene_census.json"
    if cache.exists():
        return set(json.loads(cache.read_text()))
    hits = gdc("genes", eq("is_cancer_gene_census", "true"), "symbol", size=2000)
    genes = sorted({h["symbol"] for h in hits})
    cache.write_text(json.dumps(genes))
    return set(genes)


def summarize_mutations(raw: list[dict], cgc: set[str]) -> tuple[list[dict], dict]:
    seen: dict[str, dict] = {}
    counts = {"total": 0, "proteinChanging": 0}
    for occ in raw:
        ssm = occ["ssm"]
        if ssm["ssm_id"] in seen:
            continue
        canon = [c["transcript"] for c in ssm.get("consequence", []) if c["transcript"].get("is_canonical")]
        if not canon:
            continue
        t = canon[0]
        counts["total"] += 1
        impact = (t.get("annotation") or {}).get("vep_impact")
        if impact in ("HIGH", "MODERATE"):
            counts["proteinChanging"] += 1
        gene = t["gene"]["symbol"]
        if impact not in ("HIGH", "MODERATE") or gene not in cgc:
            continue
        seen[ssm["ssm_id"]] = {
            "gene": gene,
            "change": t.get("aa_change") or ssm.get("genomic_dna_change"),
            "type": (t.get("consequence_type") or "").replace("_variant", "").replace("_", " "),
            "impact": impact.lower(),
            "dna": ssm.get("genomic_dna_change"),
        }
    muts = sorted(seen.values(), key=lambda m: (m["gene"] not in HEADLINE_GENES, m["impact"] != "high", m["gene"]))
    return muts, counts


def summarize_copy_number(path: pathlib.Path, cgc: set[str]) -> dict | None:
    if not path.exists():
        return None
    rows = read_tsv(path)
    calls = []
    values = []
    for r in rows:
        try:
            cn = int(float(r["copy_number"]))
        except (KeyError, ValueError):
            continue
        values.append(cn)
        gene = r.get("gene_name")
        if gene not in cgc:
            continue
        if cn >= AMPLIFIED:
            calls.append({"gene": gene, "copies": cn, "call": "amplified", "chromosome": r.get("chromosome")})
        elif cn == 0:
            calls.append({"gene": gene, "copies": 0, "call": "deleted", "chromosome": r.get("chromosome")})
    ploidy = int(np.median(values)) if values else 2
    threshold = max(AMPLIFIED, 2 * ploidy + 1)
    calls = [c for c in calls if c["call"] == "deleted" or c["copies"] >= threshold]
    altered = sum(1 for v in values if v != ploidy) / max(1, len(values))
    calls.sort(key=lambda c: (c["call"] != "amplified", -c["copies"], c["gene"]))
    meta = json.loads((path.parent / f"{path.name}.meta.json").read_text())
    return {
        "method": (meta.get("analysis") or {}).get("workflow_type"),
        "genesMeasured": len(values),
        "ploidy": ploidy,
        "amplifiedFrom": threshold,
        "fractionAltered": round(altered, 3),
        "calls": calls[:40],
        "callsTotal": len(calls),
    }


def summarize_expression(path: pathlib.Path, organ: str) -> dict | None:
    if not path.exists():
        return None
    rows = [r for r in read_tsv(path) if r.get("gene_type") == "protein_coding" and r.get("tpm_unstranded")]
    tpm = {r["gene_name"]: float(r["tpm_unstranded"]) for r in rows}
    ordered = np.sort(np.array(list(tpm.values())))
    panel = []
    for gene in EXPRESSION_PANEL.get(organ, ["MKI67", "CD274"]):
        if gene not in tpm:
            continue
        v = tpm[gene]
        pct = float(np.searchsorted(ordered, v, side="right")) / len(ordered) * 100
        panel.append({"gene": gene, "tpm": round(v, 1), "percentile": round(pct, 1)})
    return {"method": "RNA-seq, STAR counts (TPM)", "genesMeasured": len(tpm), "panel": panel}


def pct(slide_entity: dict) -> dict:
    keys = {
        "percent_tumor_cells": "tumourCells",
        "percent_normal_cells": "normalCells",
        "percent_stromal_cells": "stroma",
        "percent_necrosis": "necrosis",
        "percent_lymphocyte_infiltration": "lymphocytes",
        "percent_monocyte_infiltration": "monocytes",
        "percent_neutrophil_infiltration": "neutrophils",
    }
    return {v: slide_entity[k] for k, v in keys.items() if isinstance(slide_entity.get(k), (int, float))}


def slide_entity(file_hit: dict, code: str) -> dict:
    for case in file_hit.get("cases", []):
        for sample in case.get("samples", []):
            for portion in sample.get("portions", []):
                for s in portion.get("slides", []):
                    if s.get("submitter_id") == code:
                        return {**s, "sample_type": sample.get("sample_type")}
    return {}


def read_overlays(sdir: pathlib.Path) -> list[dict]:
    path = sdir / "overlays.json"
    return json.loads(path.read_text()) if path.exists() else []


def cmd_assemble(args) -> None:
    cgc = cancer_genes()
    for slide in tcga_slides():
        if args.only and slide["id"] not in args.only:
            continue
        cdir = CASES / slide["id"]
        data = json.loads((cdir / "gdc.json").read_text())
        case = data["case"][0]
        demo = case.get("demographic") or {}
        diags = case.get("diagnoses") or []
        dx = next((d for d in diags if d.get("diagnosis_is_primary_disease")), diags[0] if diags else {})
        treatments = sorted({clean(t.get("treatment_type")) for d in diags for t in d.get("treatments") or [] if t.get("treatment_or_therapy") == "yes"} - {None})
        follow = [f.get("days_to_follow_up") for f in case.get("follow_ups") or [] if isinstance(f.get("days_to_follow_up"), (int, float))]
        follow += [d.get("days_to_last_follow_up") for d in diags if isinstance(d.get("days_to_last_follow_up"), (int, float))]
        dead = (demo.get("vital_status") or "").lower() == "dead"

        patient = {
            "caseId": case["submitter_id"],
            "project": case["project"]["project_id"],
            "projectName": case["project"]["name"],
            "primarySite": case.get("primary_site"),
            "diseaseType": case.get("disease_type"),
            "sex": clean(demo.get("sex_at_birth")) or clean(demo.get("gender")),
            "ageAtDiagnosis": round(dx["age_at_diagnosis"] / 365.25) if isinstance(dx.get("age_at_diagnosis"), (int, float)) else (demo.get("age_at_index") if isinstance(demo.get("age_at_index"), int) else None),
            "yearOfDiagnosis": dx.get("year_of_diagnosis"),
            "primaryDiagnosis": clean(dx.get("primary_diagnosis")),
            "morphology": clean(dx.get("morphology")),
            "tissueOrigin": clean(dx.get("tissue_or_organ_of_origin")),
            "site": clean(dx.get("site_of_resection_or_biopsy")),
            "stage": clean(dx.get("ajcc_pathologic_stage")) or clean(dx.get("figo_stage")) or clean(dx.get("ajcc_clinical_stage")),
            "stagingSystem": "FIGO" if not clean(dx.get("ajcc_pathologic_stage")) and clean(dx.get("figo_stage")) else ("AJCC " + dx["ajcc_staging_system_edition"] if clean(dx.get("ajcc_staging_system_edition")) else "AJCC"),
            "t": clean(dx.get("ajcc_pathologic_t")),
            "n": clean(dx.get("ajcc_pathologic_n")),
            "m": clean(dx.get("ajcc_pathologic_m")),
            "grade": clean(dx.get("tumor_grade")),
            "gleason": (
                f"{dx['gleason_score']} ({dx['primary_gleason_grade'].split()[-1]} + {dx['secondary_gleason_grade'].split()[-1]})"
                if dx.get("gleason_score") and clean(dx.get("primary_gleason_grade")) and clean(dx.get("secondary_gleason_grade"))
                else (str(dx["gleason_score"]) if dx.get("gleason_score") else None)
            ),
            "priorCancers": sorted({
                f"{(clean(d.get('primary_diagnosis')) or 'Cancer').replace(', NOS', '')} of the {(clean(d.get('tissue_or_organ_of_origin')) or 'unknown site').replace(', NOS', '').lower()}"
                for d in diags
                if d is not dx and "prior" in (d.get("classification_of_tumor") or "").lower()
            }),
            "priorMalignancy": clean(dx.get("prior_malignancy")),
            "treatments": treatments,
            "vitalStatus": "Deceased" if dead else ("Alive" if (demo.get("vital_status") or "").lower() == "alive" else None),
            "survivalYears": years(demo.get("days_to_death")) if dead else None,
            "followUpYears": years(max(follow)) if follow and not dead else None,
            "gdcCaseUrl": f"https://portal.gdc.cancer.gov/cases/{case['case_id']}",
        }

        muts, counts = summarize_mutations(data["mutations"], cgc)
        genomics = {
            "mutations": muts,
            "mutationCount": counts["total"],
            "proteinChangingCount": counts["proteinChanging"],
            "copyNumber": summarize_copy_number(cdir / "copy_number.tsv", cgc),
            "expression": summarize_expression(cdir / "expression.tsv", slide["organ"]),
        }

        # Every other open file for this case, grouped by kind, so viewers can see what else exists.
        groups: dict[str, dict] = {}
        for f in data["files"]:
            g = groups.setdefault(f["data_type"], {"type": f["data_type"], "category": f.get("data_category"), "files": 0, "bytes": 0})
            g["files"] += 1
            g["bytes"] += f.get("file_size") or 0
        published = sorted(groups.values(), key=lambda g: (g["category"] or "", g["type"]))

        sdir = OUT / "slides" / slide["id"]
        report = None
        if (cdir / "report.pdf").exists():
            (sdir / "report.pdf").write_bytes((cdir / "report.pdf").read_bytes())
            meta = json.loads((cdir / "report.pdf.meta.json").read_text())
            report = {
                "file": "report.pdf",
                "bytes": (cdir / "report.pdf").stat().st_size,
                "gdcFileId": meta["file_id"],
                "sourceUrl": f"https://portal.gdc.cancer.gov/files/{meta['file_id']}",
            }

        main = barcode(slide["file"])
        main_hit = next((s for s in data["slides"] if barcode(s["file_name"]) == main), {})
        main_entity = slide_entity(main_hit, main) if main_hit else {}
        images = [{
            "key": "main",
            "barcode": main,
            "label": slide_label(main, None)[0],
            "sample": "Tumour",
            "preparation": "FFPE",
            "composition": pct(main_entity),
            "overlays": read_overlays(sdir),
        }]
        others = []
        for s in data["slides"]:
            code = barcode(s["file_name"])
            if code == main:
                continue
            key = slide_key(code)
            idir = sdir / "case" / key
            info_path = idir / "image.json"
            if not info_path.exists():
                print(f"  {slide['id']}: {code} not tiled yet, skipped")
                continue
            entity = slide_entity(s, code)
            label, sample, prep = slide_label(code, entity.get("section_location"))
            others.append({
                "key": key,
                "barcode": code,
                "label": label,
                "sample": sample,
                "preparation": prep,
                "section": SECTION.get((entity.get("section_location") or "").upper()),
                "composition": pct(entity),
                "prefix": f"case/{key}/",
                "gdcFileId": s["file_id"],
                "sourceUrl": f"https://portal.gdc.cancer.gov/files/{s['file_id']}",
                "sourceFile": s["file_name"],
                **json.loads(info_path.read_text()),
                "overlays": read_overlays(idir),
            })
        order = {"Tumour": 0, "Metastasis": 1, "Recurrent tumour": 2, "Normal tissue": 3}
        others.sort(key=lambda i: (order.get(i["sample"], 9), i["preparation"] != "FFPE", i["key"]))
        images += others

        out = {"patient": patient, "genomics": genomics, "report": report, "published": published, "images": images}
        (sdir / "case.json").write_text(json.dumps(out, indent=1))
        print(f"{slide['id']}: {len(muts)} driver mutations, {len(images)} slides, overlays on {sum(1 for i in images if i['overlays'])}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", choices=["fetch", "tile", "overlays", "assemble"])
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    args = ap.parse_args()
    {"fetch": cmd_fetch, "tile": cmd_tile, "overlays": cmd_overlays, "assemble": cmd_assemble}[args.stage](args)


if __name__ == "__main__":
    import sys

    sys.path.insert(0, str(HERE))
    main()
