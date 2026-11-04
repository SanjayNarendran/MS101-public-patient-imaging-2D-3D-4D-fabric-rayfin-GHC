"""Multiplexed immunofluorescence (CyCIF) slide -> per-marker coloured Deep Zoom pyramids.

Source: HTAN HMS, CyCIF of colorectal cancer (36 markers), DICOM slide microscopy from the NCI Imaging
Data Commons (CC BY 4.0). Each channel is built from the largest pyramid level available locally: full resolution
(24920 px, 0.65 um/pixel, 20x objective) once pipeline/dicom/download_dicom.py --only cycif has fetched it into
work/dicom_src/cycif, otherwise the reduced level in work/mif/level4 (12460 px, 1.3 um/pixel).

Input : work/dicom_src/cycif/*.dcm from `python pipeline/dicom/download_dicom.py --only cycif` (matched to markers
        by OpticalPathDescription); work/mif/level4/*.dcm is also read if present
Output: work/lakehouse/slides/<id>/channels/<marker>/slide.dzi + slide_files/, thumbnail.jpg, label.json
        and the slide is appended to work/lakehouse/manifest.json by generate_tiles.py (reads label.json).

Usage: python pipeline/build_multiplex.py [--workers 3]   (each worker needs ~8 GB of memory at full resolution)
"""
import argparse
import json
import math
import os
import pathlib
import shutil
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pydicom
from PIL import Image
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "work" / "mif"
SOURCES = [ROOT / "work" / "dicom_src" / "cycif", SRC / "level4"]
OUT = ROOT / "work" / "lakehouse" / "slides"
SLIDE_ID = "colon-cycif"
TILE, OVERLAP, QUALITY = 1022, 1, 85
GAMMA = 0.8  # lifts faint staining; applied after the percentile window
FULL_RESOLUTION_COLUMNS = 24920  # width of the slide's largest pyramid level in IDC
PREVIEW_WIDTH = 780  # thumbnail and tour hotspots are computed at this width, whatever the source level

# All 36 channels of the section, in three groups:
#   featured  - the eight key markers, shown as chips above the viewer (four on by default)
#   protein   - the other proteins, switched on from Details > Controls
#   reference - the DNA stain repeated in every imaging round (used to align the rounds) and the
#               background-only control channels
# Featured colours are chosen to read well together on black; the rest are spread around the colour wheel.
# (name, colour, shown by default, meaning, group)
MARKERS = [
    ("DNA", "#3d7bff", True, "Nuclei (Hoechst)", "featured"),
    ("Pan-cytokeratin", "#ffc21a", True, "Tumour and normal epithelium", "featured"),
    ("Aortic smooth muscle actin", "#ff3d7f", True, "Smooth muscle and stroma", "featured"),
    ("CD45", "#2ee86a", True, "All immune cells", "featured"),
    ("CD8a", "#e04bff", False, "Cytotoxic T cells", "featured"),
    ("CD68", "#18e3ff", False, "Macrophages", "featured"),
    ("Antigen Ki67", "#ffffff", False, "Proliferating cells", "featured"),
    ("CD31", "#ff8a1f", False, "Blood vessel endothelium", "featured"),
    ("CD3", "#ff5a5a", False, "All T cells", "protein"),
    ("CD4", "#ffe14d", False, "Helper T cells", "protein"),
    ("CD20", "#7dff5a", False, "B cells", "protein"),
    ("CD45RO", "#ff7ad9", False, "Memory T cells", "protein"),
    ("CD163", "#5ae0ff", False, "M2 (tissue-repair) macrophages", "protein"),
    ("FOXP3", "#b77dff", False, "Regulatory T cells", "protein"),
    ("PD-1", "#ffb35a", False, "Immune checkpoint receptor on exhausted T cells", "protein"),
    ("PD-L1", "#5affb0", False, "Immune checkpoint ligand", "protein"),
    ("E-Cadherin", "#ffd27a", False, "Epithelial cell-to-cell junctions", "protein"),
    ("Vimentin", "#ff6f91", False, "Mesenchymal and stromal cells", "protein"),
    ("CDX-2", "#9dff5a", False, "Intestinal identity (nuclear)", "protein"),
    ("Na/K ATPase", "#5ab8ff", False, "Cell membranes", "protein"),
    ("Lamin-A/B/C", "#c9a0ff", False, "Nuclear envelope", "protein"),
    ("Desmin", "#ff9a8a", False, "Muscle (bowel wall)", "protein"),
    ("PCNA", "#f0ff5a", False, "Dividing and repairing cells", "protein"),
    ("Antigen Ki67 (2)", "#e8e8e8", False, "Proliferating cells (second stain)", "protein"),
    ("Collagen", "#d6b38a", False, "Collagen fibres in connective tissue", "protein"),
] + [
    (f"DNA ({n})", "#5f8dff", False, f"Nuclei, re-stained in imaging round {n}", "reference") for n in range(2, 10)
] + [
    (f"Control-{nm}nm", "#a8a8a8", False, f"Background glow at {nm} nm (no antibody)", "reference")
    for nm in (488, 555, 647)
]


def slug(name: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in name).strip("-").replace("--", "-")


def channel_files() -> dict[str, pathlib.Path]:
    """Marker name (OpticalPathDescription) -> the largest pyramid level of that channel found in SOURCES."""
    best: dict[str, tuple[int, pathlib.Path]] = {}
    for folder in SOURCES:
        for path in sorted(folder.glob("*.dcm")):
            d = pydicom.dcmread(path, stop_before_pixels=True)
            name = str(d.OpticalPathSequence[0].get("OpticalPathDescription", ""))
            cols = int(d.TotalPixelMatrixColumns)
            if name and cols > best.get(name, (0, path))[0]:
                best[name] = (cols, path)
    return {name: path for name, (_, path) in best.items()}


def read_plane(path: str) -> np.ndarray:
    d = pydicom.dcmread(path)
    frames = d.pixel_array  # (n, 1024, 1024) uint16, TILED_FULL row-major
    cols, rows = d.TotalPixelMatrixColumns, d.TotalPixelMatrixRows
    tw, th = d.Columns, d.Rows
    nx = math.ceil(cols / tw)
    out = np.zeros((math.ceil(rows / th) * th, nx * tw), np.uint16)
    for i, f in enumerate(frames):
        r, c = divmod(i, nx)
        out[r * th:(r + 1) * th, c * tw:(c + 1) * tw] = f
    del d, frames
    return out[:rows, :cols]


def stretch(plane: np.ndarray) -> tuple[np.ndarray, float, float]:
    """Background-subtracted, percentile-normalised, gamma-corrected -> (float 0..1, low, high), in place.

    The window (low, high) and GAMMA are recorded per channel so the Pathology (OHIF) tab renders the same mapping.
    """
    sample = plane[::7, ::7].astype(np.float32)
    lo = float(np.percentile(sample, 50))  # tissue-free pixels and autofluorescence floor
    hi = float(np.percentile(sample, 99.8))
    x = plane.astype(np.float32)
    x -= lo
    x *= 1.0 / max(hi - lo, 1.0)
    np.clip(x, 0, 1, out=x)
    np.power(x, GAMMA, out=x)
    return x, lo, hi


def hex_rgb(h: str) -> np.ndarray:
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32)


def write_dzi(img: Image.Image, out_dir: pathlib.Path) -> int:
    """Minimal Deep Zoom writer (same layout as OpenSlide's DeepZoomGenerator)."""
    w, h = img.size
    max_level = math.ceil(math.log2(max(w, h)))
    files = out_dir / "slide_files"
    count = 0
    level_img = img
    for level in range(max_level, -1, -1):
        lw, lh = level_img.size
        (files / str(level)).mkdir(parents=True, exist_ok=True)
        for col in range(math.ceil(lw / TILE)):
            for row in range(math.ceil(lh / TILE)):
                x0 = max(col * TILE - OVERLAP, 0)
                y0 = max(row * TILE - OVERLAP, 0)
                x1 = min((col + 1) * TILE + OVERLAP, lw)
                y1 = min((row + 1) * TILE + OVERLAP, lh)
                level_img.crop((x0, y0, x1, y1)).save(files / str(level) / f"{col}_{row}.jpg", "JPEG", quality=QUALITY)
                count += 1
        if level > 0:
            level_img = level_img.resize((max(1, math.ceil(lw / 2)), max(1, math.ceil(lh / 2))), Image.LANCZOS)
    (out_dir / "slide.dzi").write_text(
        f'<?xml version="1.0" encoding="UTF-8"?><Image xmlns="http://schemas.microsoft.com/deepzoom/2008" '
        f'Format="jpg" Overlap="{OVERLAP}" TileSize="{TILE}"><Size Height="{h}" Width="{w}"/></Image>'
    )
    return count


def build_channel(args) -> dict:
    name, colour, default, meaning, group, path = args
    s, lo, hi = stretch(read_plane(path))
    rgb = np.empty(s.shape + (3,), np.uint8)
    for i, v in enumerate(hex_rgb(colour)):
        rgb[..., i] = s * v  # s is 0..1, so the product stays within 0..255
    del s
    img = Image.fromarray(rgb)
    del rgb
    cdir = OUT / SLIDE_ID / "channels" / slug(name)
    shutil.rmtree(cdir, ignore_errors=True)  # a different source level means a different pyramid
    tiles = write_dzi(img, cdir)
    f = max(1, img.width // PREVIEW_WIDTH)
    img.resize((img.width // f, img.height // f), Image.BOX).save(cdir / "preview.png")
    tile_bytes = sum(p.stat().st_size for p in (cdir / "slide_files").rglob("*.jpg"))
    print(f"{name}: {tiles} tiles from {img.width} px", flush=True)
    return {"id": slug(name), "name": name, "meaning": meaning, "group": group, "color": colour, "visible": default,
            "dzi": f"slides/{SLIDE_ID}/channels/{slug(name)}/slide.dzi",
            "tiles": f"slides/{SLIDE_ID}/channels/{slug(name)}/slide_files",
            "tileCount": tiles, "tilesBytes": tile_bytes,
            # Stored intensities mapped to black..colour, then raised to `gamma` (read by build_dicom.py for OHIF).
            "window": [round(lo, 1), round(max(hi, lo + 1), 1)], "gamma": GAMMA}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()
    files = channel_files()
    missing = [n for n, *_ in MARKERS if n not in files]
    if missing:
        raise SystemExit(f"Marker images not downloaded: {missing}")
    jobs = [(n, c, v, m, g, str(files[n])) for n, c, v, m, g in MARKERS]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        channels = list(pool.map(build_channel, jobs))

    d0 = pydicom.dcmread(files["DNA"], stop_before_pixels=True)
    width, height = int(d0.TotalPixelMatrixColumns), int(d0.TotalPixelMatrixRows)
    mpp = float(d0.SharedFunctionalGroupsSequence[0].PixelMeasuresSequence[0].PixelSpacing[0]) * 1000
    objective = d0.OpticalPathSequence[0].get("ObjectiveLensPower")

    # Composite of the default channels: thumbnail and tour hotspots (dense, mixed-marker regions).
    comp = None
    for ch in channels:
        if not ch["visible"]:
            continue
        p = np.asarray(Image.open(OUT / SLIDE_ID / "channels" / ch["id"] / "preview.png").convert("RGB"), np.float32)
        comp = p if comp is None else comp + p
    comp = comp.clip(0, 255).astype(np.uint8)
    thumb = Image.fromarray(comp)
    thumb.thumbnail((768, 768))
    thumb.save(OUT / SLIDE_ID / "thumbnail.jpg", "JPEG", quality=90)

    energy = ndimage.uniform_filter(comp.astype(np.float32).sum(-1), size=40)
    hs, h_, w_ = [], energy.shape[0], energy.shape[1]
    e = energy.copy()
    for _ in range(4):
        y, x = np.unravel_index(np.argmax(e), e.shape)
        hs.append({"x": round(x / w_, 5), "y": round(y / w_, 5)})
        e[max(0, y - h_ // 6): y + h_ // 6, max(0, x - w_ // 6): x + w_ // 6] = 0
    for f in (OUT / SLIDE_ID / "channels").glob("*/preview.png"):
        f.unlink()

    # Lineage: the full-resolution source is the DICOM the Pathology (OHIF) tab reads (Files/dicom); the reduced level
    # is uploaded separately to Files/raw by upload_to_onelake.sh --raw.
    raw_files = [files[n] for n, *_ in MARKERS]
    full = raw_files[0].parent == SOURCES[0]
    raw = f"dicom/pathology/files/{d0.SeriesInstanceUID}/" if full else f"raw/{SLIDE_ID}/"
    # The objective (20x) applies to the full-resolution level (24920 px); a reduced level is a lower equivalent power.
    objective_power = round(float(objective or 20) * width / FULL_RESOLUTION_COLUMNS, 2)
    label = {
        "id": SLIDE_ID,
        "kind": "fluorescence",
        "title": "Colorectal Cancer, 36-plex CyCIF",
        "organ": "Colon",
        "diagnosis": "Colon adenocarcinoma, multiplexed immunofluorescence",
        "blurb": (
            "One tissue section imaged in 36 channels by cyclic immunofluorescence: 23 proteins, the DNA stain in every "
            "round and background controls. Each channel can be switched on and off to see tumour, stroma, nuclei and the "
            "immune cells infiltrating it."
        ),
        "project": "HTAN-HMS",
        "case": d0.ContainerIdentifier,
        "sourceFile": f"{len(raw_files)} DICOM instances (one per marker, {width} px level)",
        "gdcFileId": "",
        "source": "Human Tumor Atlas Network (HTAN), Harvard Medical School, via NCI Imaging Data Commons",
        "sourceUrl": "https://portal.imaging.datacommons.cancer.gov/collections/htan_hms/",
        "license": "CC BY 4.0",
        "vendor": "RareCyte CyteFinder",
        "objectivePower": objective_power,
        "mpp": round(mpp, 4),
        "width": width,
        "height": height,
        "levels": math.ceil(math.log2(max(width, height))) + 1,
        "tileSize": TILE,
        "overlap": OVERLAP,
        "format": "jpg",
        "tileCount": sum(c["tileCount"] for c in channels),
        "tilesBytes": sum(c["tilesBytes"] for c in channels),
        "hotspots": hs,
        "rawSizeBytes": sum(p.stat().st_size for p in raw_files),
        "dzi": channels[0]["dzi"],
        "tiles": f"slides/{SLIDE_ID}/channels",
        "thumbnail": f"slides/{SLIDE_ID}/thumbnail.jpg",
        "raw": raw,
        "channels": channels,
        "markersAvailable": len(files),
    }
    (OUT / SLIDE_ID / "label.json").write_text(json.dumps(label, indent=2))
    print(json.dumps({k: label[k] for k in ("width", "height", "mpp", "tileCount", "hotspots")}))


if __name__ == "__main__":
    os.environ.setdefault("OMP_NUM_THREADS", "2")
    main()
