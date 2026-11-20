"""Package the compiled web bundle for one compatible Android binary version."""
import argparse
import hashlib
import json
from pathlib import Path
import re
from zipfile import ZIP_DEFLATED, ZipFile


def version(value: str) -> str:
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", value):
        raise argparse.ArgumentTypeError("Use a numeric version such as 1.2.0.")
    return value


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--native", required=True, type=version)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
web = root / "dist"
app_version = version(json.loads((root / "package.json").read_text())["version"])
if not (web / "index.html").is_file():
    parser.error("Run npm run build first.")
if tuple(map(int, app_version.split("."))) < tuple(map(int, args.native.split("."))):
    parser.error("The bundle cannot be older than the Android binary.")
folder = root / "release" / "hosting" / "actualizaciones" / "android" / args.native
folder.mkdir(parents=True, exist_ok=True)
archive = folder / f"GASTROLAB-{app_version}.zip"
with ZipFile(archive, "w", ZIP_DEFLATED) as bundle:
    for asset in sorted(web.rglob("*")):
        if asset.is_file():
            bundle.write(asset, asset.relative_to(web))
with archive.open("rb") as file:
    checksum = hashlib.file_digest(file, "sha256").hexdigest()
manifest = {"nativeVersion": args.native, "version": app_version, "sha256": checksum}
(folder / "latest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(folder)
