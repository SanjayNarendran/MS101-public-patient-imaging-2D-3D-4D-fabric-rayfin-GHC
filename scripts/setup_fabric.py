"""Prepare a Microsoft Fabric workspace for this app and record its IDs.

    python scripts/setup_fabric.py --workspace "<workspace name>" [--create] [--capacity-id <id>]
                                   [--lakehouse imaging_lakehouse] [--dry-run]

What it does, using your Azure CLI login (`az login`) and the public Fabric REST API:
  1. Finds the workspace by display name. With --create it creates it if it does not exist.
  2. Makes sure the workspace is on a Fabric capacity (assigns --capacity-id when it has none).
  3. Finds or creates the Lakehouse (default name: imaging_lakehouse).
  4. Writes fabric.env at the repository root (read by the pipeline scripts) and rewrites the
     <lakehouse-config> block in rayfin/functions/src/function_app.ts (read by the deployed functions).

--dry-run only reads: it reports what it found and what it would create, and writes nothing.
"""
import argparse
import pathlib
import re
import sys
import time

import requests
from azure.identity import AzureCliCredential

ROOT = pathlib.Path(__file__).resolve().parents[1]
API = "https://api.fabric.microsoft.com/v1"
FUNCTION_APP = ROOT / "rayfin" / "functions" / "src" / "function_app.ts"
ENV_FILE = ROOT / "fabric.env"


class Fabric:
    def __init__(self) -> None:
        self.cred = AzureCliCredential()

    def _headers(self) -> dict:
        token = self.cred.get_token("https://api.fabric.microsoft.com/.default").token
        return {"Authorization": f"Bearer {token}"}

    def get_all(self, path: str) -> list[dict]:
        items, url = [], f"{API}{path}"
        while url:
            r = requests.get(url, headers=self._headers(), timeout=60)
            r.raise_for_status()
            body = r.json()
            items += body.get("value", [])
            token = body.get("continuationToken")
            url = f"{API}{path}{'&' if '?' in path else '?'}continuationToken={token}" if token else None
        return items

    def post(self, path: str, payload: dict) -> dict:
        r = requests.post(f"{API}{path}", json=payload, headers=self._headers(), timeout=60)
        if r.status_code == 202 and r.headers.get("Location"):
            return self._wait(r.headers["Location"])
        if not r.ok:
            raise SystemExit(f"POST {path} failed ({r.status_code}): {r.text}")
        return r.json() if r.content else {}

    def _wait(self, url: str) -> dict:
        for _ in range(60):
            time.sleep(3)
            r = requests.get(url, headers=self._headers(), timeout=60)
            if r.ok and r.json().get("status") in ("Succeeded", "Failed"):
                status = r.json()
                if status["status"] == "Failed":
                    raise SystemExit(f"Fabric operation failed: {status}")
                result = requests.get(f"{url}/result", headers=self._headers(), timeout=60)
                return result.json() if result.ok and result.content else {}
        raise SystemExit("Timed out waiting for a Fabric operation")


def capacity_list(capacities: dict) -> str:
    rows = [f"  {c['id']}  {c['displayName']}  {c['sku']}  {c['region']}  {c['state']}" for c in capacities.values()]
    return "\n".join(rows) or "  (none visible to you)"


def write_config(ws: dict, lh: dict) -> None:
    ENV_FILE.write_text(
        "# Written by scripts/setup_fabric.py. Not committed (see .gitignore).\n"
        f"WORKSPACE_NAME={ws['displayName']}\nWORKSPACE_ID={ws['id']}\n"
        f"LAKEHOUSE_NAME={lh['displayName']}\nLAKEHOUSE_ID={lh['id']}\n"
    )

    def q(v: str) -> str:
        return "'" + v.replace("\\", "\\\\").replace("'", "\\'") + "'"

    block = (
        "// <lakehouse-config>\n"
        f"const WORKSPACE_ID = {q(ws['id'])};\n"
        f"const WORKSPACE_NAME = {q(ws['displayName'])};\n"
        f"const LAKEHOUSE_ID = {q(lh['id'])};\n"
        f"const LAKEHOUSE_NAME = {q(lh['displayName'])};\n"
        "// </lakehouse-config>"
    )
    src = FUNCTION_APP.read_text()
    new, n = re.subn(r"// <lakehouse-config>.*?// </lakehouse-config>", lambda _: block, src, flags=re.S)
    if n != 1:
        raise SystemExit(f"Could not find the <lakehouse-config> block in {FUNCTION_APP}")
    FUNCTION_APP.write_text(new)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--workspace", required=True, help="Fabric workspace display name")
    ap.add_argument("--create", action="store_true", help="create the workspace if it does not exist")
    ap.add_argument("--capacity-id", help="Fabric capacity to assign if the workspace has none")
    ap.add_argument("--lakehouse", default="imaging_lakehouse", help="Lakehouse name (letters, digits, underscores)")
    ap.add_argument("--dry-run", action="store_true", help="read only; report without creating or writing anything")
    args = ap.parse_args()
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,255}", args.lakehouse):
        raise SystemExit("Lakehouse names must start with a letter and use only letters, digits and underscores.")

    fab = Fabric()
    capacities = {c["id"]: c for c in fab.get_all("/capacities")}
    ws = next((w for w in fab.get_all("/workspaces") if w["displayName"].lower() == args.workspace.lower()), None)

    if ws is None:
        if not args.create:
            raise SystemExit(f'Workspace "{args.workspace}" not found. Re-run with --create to create it.')
        if not args.capacity_id:
            raise SystemExit(f"Creating a workspace needs --capacity-id. Capacities you can use:\n{capacity_list(capacities)}")
        print(f'Workspace "{args.workspace}" not found; {"would create" if args.dry_run else "creating"} it '
              f"on capacity {args.capacity_id}.")
        if args.dry_run:
            return
        ws = fab.post("/workspaces", {"displayName": args.workspace, "capacityId": args.capacity_id})
    print(f"Workspace   {ws['displayName']}  {ws['id']}")

    cap = capacities.get(ws.get("capacityId") or "")
    if cap is None:
        if not args.capacity_id:
            raise SystemExit(f"The workspace has no Fabric capacity. Re-run with --capacity-id. Capacities:\n"
                             f"{capacity_list(capacities)}")
        print(f"Capacity    {'would assign' if args.dry_run else 'assigning'} {args.capacity_id}")
        if not args.dry_run:
            fab.post(f"/workspaces/{ws['id']}/assignToCapacity", {"capacityId": args.capacity_id})
    else:
        print(f"Capacity    {cap['displayName']}  {cap['sku']}  {cap['region']}  {cap['state']}")
        if cap["state"] != "Active":
            raise SystemExit(f"Capacity {cap['displayName']} is {cap['state']} (paused). Resume it in the Azure portal "
                             "(Microsoft Fabric capacity > Resume), wait a minute, then run this again.")

    lakehouses = fab.get_all(f"/workspaces/{ws['id']}/lakehouses")
    lh = next((x for x in lakehouses if x["displayName"] == args.lakehouse), None)
    if lh is None:
        print(f"Lakehouse   {args.lakehouse} not found; {'would create' if args.dry_run else 'creating'} it")
        if args.dry_run:
            return
        lh = fab.post(f"/workspaces/{ws['id']}/lakehouses", {"displayName": args.lakehouse})
        if "id" not in lh:
            lh = next(x for x in fab.get_all(f"/workspaces/{ws['id']}/lakehouses") if x["displayName"] == args.lakehouse)
    print(f"Lakehouse   {lh['displayName']}  {lh['id']}")

    if args.dry_run:
        print("Dry run: nothing written.")
        return
    write_config(ws, lh)
    print(f"Wrote {ENV_FILE.relative_to(ROOT)} and updated {FUNCTION_APP.relative_to(ROOT)}")
    print(f'Next: download and build the data (README step 6), then deploy with: npx rayfin up -w "{ws["displayName"]}"')


if __name__ == "__main__":
    try:
        main()
    except requests.HTTPError as e:
        sys.exit(f"Fabric API error: {e.response.status_code} {e.response.text}")
