"""Index genuine DICOM files for the OHIF tabs, without converting them.

The OHIF tabs read the original .dcm files straight from OneLake: no DICOMweb server and no image conversion. This
script lays the files out under `work/dicom/<dataset>/` (the same layout is uploaded to the Lakehouse at
`Files/dicom/<dataset>/`) and writes small sidecar indexes that let the browser find what it needs:

    studies.json                          the worklist: one row per study
    studies/<StudyUID>.json               the study's series
    series/<SeriesUID>/metadata.json      DICOM JSON (PS3.18 F.2) for every instance, without pixel data; large binary
                                          values (annotation coordinates) become BulkDataURIs pointing at byte ranges
                                          of the original file ("files/...dcm#<offset>,<length>")
    series/<SeriesUID>/thumbnail.jpg      a preview for the worklist and study browser (image series only)
    series/<SeriesUID>/display.json       fluorescence slides only: per-channel colour, contrast window and default
                                          visibility (the viewer's starting display, not part of the DICOM data)
    files/<SeriesUID>/<SOPUID>.dcm        the original file, byte for byte (hard-linked from the download folder)
    files/<SeriesUID>/<SOPUID>.frames     slides only: little-endian float64 (offset, length) pairs, one per frame,
                                          locating each tile inside the .dcm so the viewer can fetch it with one
                                          HTTP range request

Usage:
    python pipeline/dicom/build_dicom.py [--only pathology|radiology] [--force]
"""
from __future__ import annotations

import argparse
import glob
import sys
import json
import os
import pathlib
import shutil
import struct
import time
from collections import defaultdict

import numpy as np
import pydicom
from PIL import Image
from pydicom.dataelem import RawDataElement
from pydicom.tag import Tag

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORK = ROOT / "work"
OUT = WORK / "dicom"
IDC = WORK / "dicom_src" / "idc"

PIXEL_TAGS = {Tag(0x7FE00010), Tag(0x7FE00008), Tag(0x7FE00009)}  # PixelData, FloatPixelData, DoubleFloatPixelData
BULK_VRS = {"OB", "OW", "OF", "OD", "OL", "OV", "UN"}
BULK_THRESHOLD = 1024
SM_CLASS = "1.2.840.10008.5.1.4.1.1.77.1.6"
NO_IMAGE = {"SEG", "SR", "RTSTRUCT", "ANN", "KO", "PR"}

LICENCES = {
    "tcga": ("The Cancer Genome Atlas, NCI Imaging Data Commons", "CC BY 3.0"),
    "htan_hms": ("Human Tumor Atlas Network (HMS), NCI Imaging Data Commons", "CC BY 4.0"),
    "fdg_pet_ct_lesions": ("FDG-PET-CT-Lesions (Gatidis & Kuestner), NCI Imaging Data Commons", "CC BY 4.0"),
    "4d_lung": ("4D-Lung (Hugo et al.), NCI Imaging Data Commons", "CC BY 3.0"),
    "upenn_gbm": ("UPENN-GBM (Bakas et al.) with BAMF AIMI segmentations, NCI Imaging Data Commons", "CC BY 4.0"),
    "prostatex": ("PROSTATEx with prostate zone segmentations, NCI Imaging Data Commons", "CC BY 3.0 / 4.0"),
    "nlst": ("NLST with TotalSegmentator segmentations, NCI Imaging Data Commons", "CC BY 4.0"),
}


# ------------------------------------------------------------------------------------------------ sources
def sources(dataset: str) -> list[tuple[str, pathlib.Path]]:
    """(source key, file) for every DICOM file of a dataset."""
    files: list[tuple[str, pathlib.Path]] = []
    if dataset == "pathology":
        for coll in sorted(IDC.glob("tcga_*")):
            files += [("tcga", p) for p in coll.rglob("*.dcm")]
        files += [("htan_hms", p) for p in (WORK / "dicom_src" / "cycif").glob("*.dcm")]
        files += [("htan_hms", p) for p in (WORK / "mif" / "level0").glob("*.dcm")]
        files += [("htan_hms", p) for p in (WORK / "mif" / "level4").glob("*.dcm")]
    else:
        files += [("fdg_pet_ct_lesions", p) for p in (WORK / "petct" / "study").rglob("*.dcm")]
        files += [("4d_lung", p) for p in (WORK / "lung4d" / "dicom").rglob("*.dcm")]
        for key in ("upenn_gbm", "prostatex", "nlst"):
            files += [(key, p) for p in (IDC / key).rglob("*.dcm")]
    # De-duplicate (CyCIF levels can sit both in work/mif and in work/dicom_src/cycif; IDC names them by instance UUID).
    seen: dict[str, tuple[str, pathlib.Path]] = {}
    for key, p in files:
        seen.setdefault(p.name if key == "htan_hms" else str(p.resolve()), (key, p))
    return list(seen.values())


# ------------------------------------------------------------------------------------------------ DICOM JSON
def fluorescence_display(items: list) -> dict | None:
    """Starting colours, contrast windows and gamma for a multiplexed fluorescence series, identical to the Pathology
    tab's tiles: colours from build_multiplex.MARKERS, and each channel's window and gamma from the label.json that
    build_multiplex.py wrote. Without it, the window is the 50th to 99.8th percentile of a mid-size level, linear."""
    sys.path.insert(0, str(ROOT / "pipeline"))
    from build_multiplex import MARKERS, OUT as TILE_OUT, SLIDE_ID

    colours = {name: (colour, shown, group, i) for i, (name, colour, shown, _, group) in enumerate(MARKERS)}
    label = TILE_OUT / SLIDE_ID / "label.json"
    tiled = {c["name"]: c for c in json.loads(label.read_text())["channels"]} if label.exists() else {}
    by_path: dict[str, list] = defaultdict(list)
    for _, ds, path in items:
        op = ds.OpticalPathSequence[0]
        by_path[str(op.OpticalPathIdentifier)].append((int(ds.TotalPixelMatrixColumns), path, str(op.get("OpticalPathDescription", ""))))
    channels = {}
    gammas = set()
    for ident, levels in by_path.items():
        levels.sort()
        cols, path, name = next((lv for lv in levels if lv[0] >= 1500), levels[-1])
        if "window" in tiled.get(name, {}):
            lo, hi = tiled[name]["window"]
            gammas.add(tiled[name].get("gamma", 1.0))
        else:
            arr = pydicom.dcmread(path).pixel_array.astype(np.float32)
            lo, hi = float(np.percentile(arr, 50)), float(np.percentile(arr, 99.8))
            gammas.add(1.0)
        colour, shown, group, order = colours.get(name, ("#ffffff", False, "protein", 999))
        rgb = [int(colour[i : i + 2], 16) for i in (1, 3, 5)]
        channels[ident] = {
            "name": name, "color": rgb, "visible": shown, "group": group, "order": order,
            "limitValues": [round(lo, 1), round(max(hi, lo + 1), 1)],
        }
    # One curve for the whole slide (the OHIF extension applies it to every channel layer).
    return {"gamma": gammas.pop() if len(gammas) == 1 else 1.0, "channels": channels}


def _raw_bulk(raw: RawDataElement) -> bool:
    return raw.length not in (0, 0xFFFFFFFF) and raw.length > BULK_THRESHOLD


def to_json(ds: pydicom.Dataset, file_rel: str, base: int | None = 0) -> dict:
    """DICOM JSON of a dataset read with defer_size, with large binary values as byte-range BulkDataURIs.

    Inside a sequence pydicom records value offsets relative to the start of the sequence value, so `base` is that
    sequence's file offset (None when unknown: values are then kept inline). This keeps the nucleus outlines of the
    annotation (ANN) series, hundreds of MB, out of metadata.json; the slide viewer fetches them by byte range.
    """
    out: dict = {}
    for tag in sorted(ds._dict.keys()):
        if tag in PIXEL_TAGS or tag.group == 0x0002 or tag.group % 2 == 1:
            continue  # pixel data is read from the file; private tags stay in the file only
        raw = ds._dict[tag]
        key = f"{tag:08X}"
        if base is not None and isinstance(raw, RawDataElement) and _raw_bulk(raw):
            vr = raw.VR or pydicom.datadict.dictionary_VR(tag)
            if vr in BULK_VRS:
                out[key] = {"vr": vr, "BulkDataURI": f"{file_rel}#{base + raw.value_tell},{raw.length}"}
                continue
        elem = ds[tag]
        if elem.VR == "SQ":
            child = base + raw.value_tell if base is not None and isinstance(raw, RawDataElement) else None
            out[key] = {"vr": "SQ", "Value": [to_json(item, file_rel, child) for item in elem.value]}
            continue
        try:
            out[key] = elem.to_json_dict(bulk_data_element_handler=None, bulk_data_threshold=10**9)
        except Exception as error:  # an unreadable private value must not break the study
            print(f"    skip {key} ({elem.VR}): {error}")
    return out


# ------------------------------------------------------------------------------------------------ frames
def frame_index(path: pathlib.Path, ds: pydicom.Dataset) -> np.ndarray | None:
    """(offset, length) of each frame of PixelData inside the file, or None if it cannot be located."""
    raw = ds._dict.get(Tag(0x7FE00010))
    if raw is None or not isinstance(raw, RawDataElement):
        return None
    n = int(ds.get("NumberOfFrames", 1) or 1)
    start = raw.value_tell
    if raw.length != 0xFFFFFFFF:  # native (uncompressed): frames are back to back
        size = int(ds.Rows) * int(ds.Columns) * int(ds.SamplesPerPixel) * int(ds.BitsAllocated) // 8
        if size * n > raw.length:
            return None
        return np.array([(start + i * size, size) for i in range(n)], dtype="<f8")
    with open(path, "rb") as f:  # encapsulated: Basic Offset Table item, then one item per fragment
        f.seek(start)
        items = []
        while True:
            head = f.read(8)
            if len(head) < 8:
                break
            group, elem, length = struct.unpack("<HHI", head)
            if (group, elem) == (0xFFFE, 0xE0DD):
                break
            if (group, elem) != (0xFFFE, 0xE000):
                return None
            items.append((f.tell(), length))
            f.seek(length, 1)
    bot, fragments = items[0], items[1:]
    if len(fragments) == n:
        return np.array(fragments, dtype="<f8")
    if bot[1] == 4 * n:  # several fragments per frame: group them with the Basic Offset Table
        with open(path, "rb") as f:
            f.seek(bot[0])
            offsets = struct.unpack(f"<{n}I", f.read(4 * n))
        first = fragments[0][0] - 8
        frames = []
        for i, off in enumerate(offsets):
            end = offsets[i + 1] if i + 1 < n else None
            parts = [fr for fr in fragments if fr[0] - 8 - first >= off and (end is None or fr[0] - 8 - first < end)]
            if len(parts) != 1:
                return None  # multi-fragment frames would need concatenation; not used by our sources
            frames.append(parts[0])
        return np.array(frames, dtype="<f8")
    return None


# ------------------------------------------------------------------------------------------------ thumbnails
def window(img: np.ndarray, ds: pydicom.Dataset) -> np.ndarray:
    img = img.astype(np.float32) * float(ds.get("RescaleSlope", 1) or 1) + float(ds.get("RescaleIntercept", 0) or 0)
    if ds.Modality == "CT":
        lo, hi = -160, 240
    else:
        lo, hi = np.percentile(img, 1), np.percentile(img, 99.5)
    out = np.clip((img - lo) / max(hi - lo, 1e-6), 0, 1)
    if ds.Modality == "PT":
        out = 1 - out
    return (out * 255).astype(np.uint8)


def series_thumbnail(instances: list[tuple[pathlib.Path, pydicom.Dataset]], dest: pathlib.Path) -> bool:
    try:
        ordered = sorted(instances, key=lambda x: float((x[1].get("ImagePositionPatient") or [0, 0, x[1].get("InstanceNumber", 0) or 0])[2]))
        path, _ = ordered[len(ordered) // 2]
        ds = pydicom.dcmread(path)
        arr = ds.pixel_array
        if arr.ndim == 3 and ds.get("SamplesPerPixel", 1) == 1:
            arr = arr[arr.shape[0] // 2]
        if ds.get("PhotometricInterpretation", "").startswith("MONOCHROME"):
            arr = window(arr, ds)
            if ds.PhotometricInterpretation == "MONOCHROME1":
                arr = 255 - arr
        img = Image.fromarray(arr).convert("RGB")
        img.thumbnail((256, 256))
        dest.parent.mkdir(parents=True, exist_ok=True)
        img.save(dest, "JPEG", quality=85)
        return True
    except Exception as error:
        print(f"    no thumbnail: {error}")
        return False


def slide_thumbnails() -> dict[str, pathlib.Path]:
    """Container (slide barcode) → the white-balanced thumbnail made by the tile pipeline."""
    thumbs: dict[str, pathlib.Path] = {}
    for f in glob.glob(str(WORK / "lakehouse" / "slides" / "*" / "case.json")):
        sdir = pathlib.Path(f).parent
        for img in json.loads(pathlib.Path(f).read_text())["images"]:
            thumbs[img["barcode"]] = sdir / ("thumbnail.jpg" if img["key"] == "main" else f"{img['prefix']}thumbnail.jpg")
    cycif = WORK / "lakehouse" / "slides" / "colon-cycif" / "thumbnail.jpg"
    if cycif.exists():
        thumbs["HTA7_920_1000"] = cycif
    return thumbs


# ------------------------------------------------------------------------------------------------ build
def text(v) -> str:
    return str(v) if v not in (None, "") else ""


def build(dataset: str, force: bool) -> None:
    out = OUT / dataset
    if force and out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    files = sources(dataset)
    print(f"{dataset}: {len(files)} files", flush=True)

    series: dict[str, list] = defaultdict(list)
    study_meta: dict[str, dict] = {}
    study_source: dict[str, str] = {}
    for key, path in files:
        ds = pydicom.dcmread(path, defer_size=BULK_THRESHOLD)
        sop, se, st = ds.SOPInstanceUID, ds.SeriesInstanceUID, ds.StudyInstanceUID
        rel = f"files/{se}/{sop}.dcm"
        dest = out / rel
        if not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.link(path, dest)
            except OSError:
                shutil.copy2(path, dest)
        entry = {"file": rel, "dicom": to_json(ds, rel)}
        if ds.SOPClassUID == SM_CLASS:
            idx = frame_index(path, ds)
            if idx is None:
                raise RuntimeError(f"cannot index frames of {path}")
            frames_rel = f"files/{se}/{sop}.frames"
            (out / frames_rel).write_bytes(idx.tobytes())
            entry["frames"] = frames_rel
        series[se].append((entry, ds, path))
        study_meta.setdefault(st, {})
        study_source.setdefault(st, key)

    thumbs = slide_thumbnails() if dataset == "pathology" else {}
    studies: dict[str, dict] = {}
    for se, items in series.items():
        items.sort(key=lambda x: (int(x[1].get("InstanceNumber", 0) or 0), x[1].SOPInstanceUID))
        ds0 = items[0][1]
        st = ds0.StudyInstanceUID
        sdir = out / "series" / se
        sdir.mkdir(parents=True, exist_ok=True)
        (sdir / "metadata.json").write_text(json.dumps([e for e, _, _ in items], separators=(",", ":")))
        thumb = None
        if ds0.Modality not in NO_IMAGE:
            dest = sdir / "thumbnail.jpg"
            if ds0.Modality == "SM":
                src = thumbs.get(text(ds0.get("ContainerIdentifier")))
                if src and src.exists():
                    shutil.copy2(src, dest)
                    thumb = f"series/{se}/thumbnail.jpg"
            elif dest.exists() or series_thumbnail([(p, d) for _, d, p in items], dest):
                thumb = f"series/{se}/thumbnail.jpg"
        display = None
        if ds0.Modality == "SM" and ds0.get("PhotometricInterpretation") == "MONOCHROME2" and "OpticalPathSequence" in ds0:
            (sdir / "display.json").write_text(json.dumps(fluorescence_display(items), indent=1))
            display = f"series/{se}/display.json"
        study = studies.setdefault(st, {"StudyInstanceUID": st, "series": [], "first": ds0})
        study["series"].append({
            "SeriesInstanceUID": se,
            "Modality": ds0.Modality,
            "SeriesDescription": text(ds0.get("SeriesDescription")) or (text(ds0.get("ContainerIdentifier")) if ds0.Modality == "SM" else ""),
            "SeriesNumber": int(ds0.get("SeriesNumber", 0) or 0),
            "SeriesDate": text(ds0.get("SeriesDate")),
            "SeriesTime": text(ds0.get("SeriesTime")),
            "NumberOfSeriesRelatedInstances": len(items),
            "metadata": f"series/{se}/metadata.json",
            **({"thumbnail": thumb} if thumb else {}),
            **({"display": display} if display else {}),
        })

    (out / "studies").mkdir(exist_ok=True)
    rows = []
    for st, study in studies.items():
        ds0 = study.pop("first")
        study["series"].sort(key=lambda s: (s["Modality"] in NO_IMAGE, s["SeriesNumber"], s["SeriesDescription"]))
        (out / "studies" / f"{st}.json").write_text(json.dumps(study, indent=1))
        source, licence = LICENCES[study_source[st]]
        modalities = sorted({s["Modality"] for s in study["series"]})
        name = ds0.get("PatientName")
        rows.append({
            "StudyInstanceUID": st,
            "PatientName": str(name) if name else text(ds0.get("PatientID")),
            "PatientID": text(ds0.get("PatientID")),
            "PatientSex": text(ds0.get("PatientSex")),
            "PatientAge": text(ds0.get("PatientAge")),
            "StudyDate": text(ds0.get("StudyDate")),
            "StudyTime": text(ds0.get("StudyTime")),
            "StudyDescription": text(ds0.get("StudyDescription")),
            "AccessionNumber": text(ds0.get("AccessionNumber")),
            "ModalitiesInStudy": "\\".join(modalities),
            "NumberOfStudyRelatedSeries": len(study["series"]),
            "NumberOfStudyRelatedInstances": sum(s["NumberOfSeriesRelatedInstances"] for s in study["series"]),
            "source": source,
            "licence": licence,
        })
    rows.sort(key=lambda r: (r["PatientID"], r["StudyDate"], r["StudyDescription"]))
    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    (out / "studies.json").write_text(json.dumps({
        "dataset": dataset,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "studies": rows,
        "bytes": size,
        "files": sum(1 for p in out.rglob("*.dcm")),
    }, indent=1))
    print(f"{dataset}: {len(rows)} studies, {len(series)} series, {size / 1e9:.1f} GB in {time.time() - t0:.0f}s", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["pathology", "radiology"])
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    for dataset in ("radiology", "pathology"):
        if not args.only or args.only == dataset:
            build(dataset, args.force)


if __name__ == "__main__":
    main()
