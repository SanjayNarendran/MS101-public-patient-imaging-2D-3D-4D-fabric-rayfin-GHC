"""Download genuine DICOM from the NCI Imaging Data Commons for the OHIF tabs (Pathology (OHIF), 3D/4D (OHIF)).

Nothing is converted: the files are kept as published, and `build_dicom.py` indexes them for OneLake.

    python pipeline/dicom/download_dicom.py [--only pathology|cycif|radiology] [--dry-run]

Pathology (slides CC BY 3.0, nuclei CC BY 4.0):
  - the VL Whole Slide Microscopy series of every TCGA slide in the catalog (diagnostic, frozen and normal sections;
    barcodes from work/lakehouse/slides/*/case.json, written by pipeline/build_cases.py)
  - Pan-Cancer-Nuclei-Seg bulk annotations (ANN) of those slides
  - HTAN CyCIF colorectal (CC BY 4.0): every pyramid level of all 36 channels, from full resolution (24920 px,
    0.65 um) down to 779 px (216 files, ~67 GB); files already in work/mif (older builds) are not downloaded again
Radiology (CC BY 3.0 / 4.0): the PET/CT and 4D-Lung studies already in work/petct and work/lung4d, plus
  - UPENN-GBM-00085: five brain MRI sequences, each with an AI tumour segmentation (BAMF AIMI annotations)
  - ProstateX-0199: prostate MRI study with prostate zone segmentations
  - NLST 112397: low-dose chest CT with TotalSegmentator organ segmentations
"""
from __future__ import annotations

import argparse
import glob
import json
import pathlib

from idc_index import IDCClient

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "work" / "dicom_src" / "idc"
TEMPLATE = "%collection_id/%PatientID/%StudyInstanceUID/%Modality_%SeriesInstanceUID"

# key: (collection, PatientID, StudyInstanceUID or None for every study of the patient)
RADIOLOGY_STUDIES = {
    "upenn-gbm": ("upenn_gbm", "UPENN-GBM-00085", None),
    "prostatex": ("prostatex", "ProstateX-0199", "1.3.6.1.4.1.14519.5.2.1.7311.5101.340231490512541359376572549708"),
    "nlst-totalseg": ("nlst", "112397", "1.2.840.113654.2.55.245841627194020833619958544023291521354"),
}
# Only series whose licence allows commercial use (IDC also holds CC BY-NC collections).
COMMERCIAL_USE = "i.license_short_name not like '%NC%'"
CYCIF_SERIES = "1.3.6.1.4.1.5962.99.1.2343322182.1764456793.1655905763910.4.0"
CYCIF_FOLDERS = ("dicom_src/cycif", "mif/level0", "mif/level4")  # under work/; earlier builds kept levels in work/mif


def slide_barcodes() -> list[str]:
    codes = []
    for f in sorted(glob.glob(str(ROOT / "work" / "lakehouse" / "slides" / "*" / "case.json"))):
        codes += [i["barcode"] for i in json.loads(pathlib.Path(f).read_text())["images"]]
    return codes


def download(c: IDCClient, dry_run: bool, **selection) -> None:
    c.download_from_selection(downloadDir=str(SRC), dirTemplate=TEMPLATE, dry_run=dry_run, quiet=True, show_progress_bar=False, **selection)


def pathology(c: IDCClient, dry_run: bool) -> None:
    c.fetch_index("sm_index")
    c.fetch_index("ann_index")
    ids = ",".join(f"'{b}'" for b in slide_barcodes())
    sm = c.sql_query(
        "select i.SeriesInstanceUID uid from index i join sm_index s on s.SeriesInstanceUID = i.SeriesInstanceUID "
        f"where s.ContainerIdentifier in ({ids}) and {COMMERCIAL_USE}"
    )
    ann = c.sql_query(
        "select i.SeriesInstanceUID uid from index i join ann_index a on a.SeriesInstanceUID = i.SeriesInstanceUID "
        "join sm_index s on s.SeriesInstanceUID = a.referenced_SeriesInstanceUID "
        f"where s.ContainerIdentifier in ({ids}) and i.analysis_result_id = 'pan_cancer_nuclei_seg_dicom' "
        f"and {COMMERCIAL_USE}"
    )
    print(f"pathology: {len(sm)} slide series, {len(ann)} nuclei annotation series", flush=True)
    download(c, dry_run, seriesInstanceUID=list(sm.uid) + list(ann.uid))


def cycif(c: IDCClient, dry_run: bool) -> None:
    """Every pyramid level of the 36-channel CyCIF series (216 files, ~67 GB), skipping files already on disk."""
    c.fetch_index("sm_instance_index")  # needed for instance-level downloads
    rows = c.sql_query(
        "select SOPInstanceUID sop, crdc_instance_uuid uuid, TotalPixelMatrixColumns cols, instance_size size "
        f"from sm_instance_index where SeriesInstanceUID = '{CYCIF_SERIES}'"
    )
    have = {p.stem for folder in CYCIF_FOLDERS for p in (ROOT / "work" / folder).glob("*.dcm")}
    todo = rows[~rows.uuid.isin(have)]
    levels = sorted(set(rows.cols), reverse=True)
    print(f"cycif: {len(rows)} files at {levels} px; {len(todo)} to download ({todo['size'].sum() / 1e9:.1f} GB)", flush=True)
    if todo.empty:
        return
    # Instance downloads need a flat folder: a series-level template would write every instance to one file name.
    dest = SRC.parent / "cycif"
    dest.mkdir(parents=True, exist_ok=True)
    c.download_from_selection(downloadDir=str(dest), dirTemplate=None, dry_run=dry_run, quiet=True, show_progress_bar=False, sopInstanceUID=list(todo.sop))


def radiology(c: IDCClient, dry_run: bool) -> None:
    for key, (collection, patient, study) in RADIOLOGY_STUDIES.items():
        where = f"collection_id = '{collection}' and PatientID = '{patient}'" + (f" and StudyInstanceUID = '{study}'" if study else "")
        df = c.sql_query(f"select SeriesInstanceUID uid, license_short_name lic from index where {where}")
        df = df[~df.lic.str.contains("NC")]
        print(f"{key}: {len(df)} series ({', '.join(sorted(set(df.lic)))})", flush=True)
        download(c, dry_run, seriesInstanceUID=list(df.uid))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["pathology", "cycif", "radiology"])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    c = IDCClient()
    for name, fn in (("radiology", radiology), ("cycif", cycif), ("pathology", pathology)):
        if not args.only or args.only == name:
            fn(c, args.dry_run)


if __name__ == "__main__":
    main()
