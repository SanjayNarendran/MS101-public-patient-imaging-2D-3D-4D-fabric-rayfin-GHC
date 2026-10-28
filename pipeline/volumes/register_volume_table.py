"""Register the volume catalog as a Delta table (`volumes`) in the Lakehouse, next to `slides`."""
import csv
import io
import json
import os
import pathlib
import sys
import time

import requests
from azure.identity import AzureCliCredential
from azure.storage.filedatalake import DataLakeServiceClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import fabric_config  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORKSPACE_ID = fabric_config.get("WORKSPACE_ID")
LAKEHOUSE_ID = fabric_config.get("LAKEHOUSE_ID")
COLUMNS = ["id", "category", "title", "modality", "subject", "license", "source", "sourceUrl",
           "dims", "spacingMm", "sizeBytes", "rawPath", "rawFiles", "rawSizeBytes", "layers", "frames"]


def main() -> None:
    manifest = json.loads((ROOT / "work" / "volumes" / "manifest.json").read_text())
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLUMNS, extrasaction="ignore")
    w.writeheader()
    for s in manifest["studies"]:
        w.writerow({**s, "dims": "x".join(map(str, s["dims"])), "spacingMm": "x".join(map(str, s["spacingMm"])),
                    "layers": ";".join(l["id"] for l in s["layers"]),
                    "frames": len((s.get("timeline") or {}).get("frames", [])) or 1})
    cred = AzureCliCredential()
    lake = DataLakeServiceClient("https://onelake.dfs.fabric.microsoft.com", credential=cred)
    lake.get_file_system_client(WORKSPACE_ID).get_file_client(
        f"{LAKEHOUSE_ID}/Files/catalog/volumes.csv").upload_data(buf.getvalue().encode(), overwrite=True)
    token = cred.get_token("https://api.fabric.microsoft.com/.default").token
    resp = requests.post(
        f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}/lakehouses/{LAKEHOUSE_ID}/tables/volumes/load",
        json={"relativePath": "Files/catalog/volumes.csv", "pathType": "File", "mode": "Overwrite",
              "formatOptions": {"format": "Csv", "header": True, "delimiter": ","}},
        headers={"Authorization": f"Bearer {token}"}, timeout=60)
    resp.raise_for_status()
    op = resp.headers.get("Location")
    while op:
        time.sleep(3)
        status = requests.get(op, headers={"Authorization": f"Bearer {token}"}, timeout=60).json()
        if status.get("status") in ("Succeeded", "Failed"):
            if status["status"] == "Failed":
                raise SystemExit(json.dumps(status, indent=2))
            break
    print(f"Loaded {len(manifest['studies'])} rows into table `volumes`")


if __name__ == "__main__":
    main()
