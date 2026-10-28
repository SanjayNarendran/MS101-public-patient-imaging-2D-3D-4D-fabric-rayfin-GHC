"""Download the curated TCGA whole-slide images listed in slides.json from the GDC.

Usage: python pipeline/download_slides.py [--out work/raw]
"""
import argparse
import json
import pathlib
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = pathlib.Path(__file__).parent
GDC_DATA = "https://api.gdc.cancer.gov/data/"


def fetch(slide: dict, out: pathlib.Path) -> str:
    dest = out / slide["file"]
    if dest.exists() and dest.stat().st_size > 0:
        return f"skip {dest.name}"
    tmp = dest.with_suffix(".part")
    urllib.request.urlretrieve(GDC_DATA + slide["gdcFileId"], tmp)
    tmp.rename(dest)
    return f"done {dest.name}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE.parent / "work" / "raw"))
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    slides = json.loads((HERE / "slides.json").read_text())
    with ThreadPoolExecutor(6) as pool:
        for msg in pool.map(lambda s: fetch(s, out), slides):
            print(msg)


if __name__ == "__main__":
    main()
