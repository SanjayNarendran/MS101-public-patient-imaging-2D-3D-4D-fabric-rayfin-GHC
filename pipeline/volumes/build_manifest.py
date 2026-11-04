"""Collect work/volumes/*/study.json into work/volumes/manifest.json (the catalog the app reads).

Studies whose source is DICOM in the 3D/4D (OHIF) tab (pipeline/dicom/build_dicom.py) also get `study`: the patient,
date and type its OHIF study list shows, matched on `patientId`. Rerun after build_dicom.py.
"""
import json
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "work" / "volumes"
sys.path.insert(0, str(ROOT / "pipeline" / "dicom"))
from study_refs import load_studies, match_study, study_ref  # noqa: E402

ORDER = [
    "petct-whole-body", "totalseg-ct-angio", "visible-human-body", "visible-human-head",
    "lung-4dct", "brain-tractography",
    "fetal-face-atlas", "fetal-body-atlas", "fetal-brain-atlas",
]


def main() -> None:
    studies = {p.parent.name: json.loads(p.read_text()) for p in OUT.glob("*/study.json")}
    ordered = [studies[k] for k in ORDER if k in studies] + [v for k, v in sorted(studies.items()) if k not in ORDER]
    for s in ordered:
        frames = (s.get("timeline") or {}).get("frames", [])
        s["sizeBytes"] = (sum(l.get("bytes", 0) for l in s["layers"]) + sum(f.get("bytes", 0) for f in frames)
                          + (s.get("mip") or {}).get("bytes", 0))
    dicom = load_studies(ROOT / "work" / "dicom" / "radiology" / "studies.json")
    for s in ordered:
        match = match_study(dicom, s.get("patientId"))
        if match:
            s["study"] = study_ref(match)
        else:
            s.pop("study", None)
    manifest = {
        "title": "Rayfin Imaging: 3D and 4D volumes",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "studies": ordered,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    for s in ordered:
        print(f"{s['id']:22} {s['sizeBytes'] / 1e6:7.1f} MB served   {s['rawSizeBytes'] / 1e9:6.2f} GB source")


if __name__ == "__main__":
    main()
