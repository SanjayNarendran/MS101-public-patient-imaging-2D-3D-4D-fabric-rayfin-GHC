#!/usr/bin/env bash
# Upload the original DICOM files and their sidecar indexes for the OHIF tabs to the Lakehouse (OneLake).
#
#   Files/dicom/<dataset>/studies.json, studies/, series/     worklist, series metadata (DICOM JSON), thumbnails
#   Files/dicom/<dataset>/files/<series>/<sop>.dcm             the original DICOM files, unchanged
#   Files/dicom/<dataset>/files/<series>/<sop>.frames          slide tile index (byte offsets into the .dcm)
#
# <dataset> is pathology or radiology (pipeline/dicom/build_dicom.py). Uses your Azure CLI login (`az login`).
set -euo pipefail

# shellcheck source=/dev/null
source "$(dirname "$0")/../fabric_env.sh"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="https://onelake.blob.fabric.microsoft.com/${WORKSPACE_ID}/${LAKEHOUSE_ID}/Files/dicom"

export AZCOPY_AUTO_LOGIN_TYPE=AZCLI
OPTS=(--recursive --overwrite=ifSourceNewer --trusted-microsoft-suffixes=onelake.blob.fabric.microsoft.com
      --log-level=ERROR --output-level=essential)

for dataset in radiology pathology; do
  src="${ROOT}/work/dicom/${dataset}"
  [[ -d "${src}" ]] || continue
  azcopy copy "${src}" "${DEST}/" "${OPTS[@]}" --content-type=application/dicom --include-pattern="*.dcm"
  azcopy copy "${src}" "${DEST}/" "${OPTS[@]}" --content-type=application/octet-stream --include-pattern="*.frames"
  azcopy copy "${src}" "${DEST}/" "${OPTS[@]}" --content-type=image/jpeg --include-pattern="*.jpg"
  # The indexes change whenever build_dicom.py is re-run, so always overwrite them.
  azcopy copy "${src}" "${DEST}/" --recursive --overwrite=true --trusted-microsoft-suffixes=onelake.blob.fabric.microsoft.com \
    --log-level=ERROR --output-level=essential --content-type=application/json --include-pattern="*.json"
done
echo "Uploaded to ${DEST}"
