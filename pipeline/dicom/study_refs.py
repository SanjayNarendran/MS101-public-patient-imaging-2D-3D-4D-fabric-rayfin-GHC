"""Links catalog entries (slides, 3D/4D studies) to their study in the OHIF tabs' DICOM index.

The app lists a case the way the OHIF study list does (patient, type, date), so the same case can be found in both.
Used by pipeline/generate_tiles.py (pathology) and pipeline/volumes/build_manifest.py (radiology).
"""
import json
import pathlib


def load_studies(studies_file: pathlib.Path) -> list[dict]:
    """The worklist rows written by build_dicom.py, or [] when the DICOM tabs have not been built."""
    if not studies_file.exists():
        return []
    return json.loads(studies_file.read_text())["studies"]


def match_study(studies: list[dict], patient_code: str | None) -> dict | None:
    """The study whose PatientID is the code, or whose PatientID prefixes it (HTAN biospecimen HTA7_920_1000)."""
    if not patient_code:
        return None
    return next((s for s in studies if s["PatientID"] == patient_code), None) or next(
        (s for s in studies if patient_code.startswith(s["PatientID"] + "_")), None
    )


def study_ref(study: dict) -> dict:
    """The fields the OHIF study list shows, plus the study UID."""
    return {
        "studyInstanceUid": study["StudyInstanceUID"],
        "patientName": study.get("PatientName", ""),
        "patientId": study["PatientID"],
        "studyDate": study.get("StudyDate", ""),
        "studyTime": study.get("StudyTime", ""),
        "modalities": study.get("ModalitiesInStudy", ""),
        "description": study.get("StudyDescription", ""),
    }
