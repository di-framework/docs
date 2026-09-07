#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path


manifest = Path(sys.argv[1])
raw_version = sys.argv[2]
match = re.fullmatch(r"v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", raw_version)
if not match:
    raise SystemExit(f"framework version must be a stable semantic version: {raw_version!r}")

major, minor, patch = match.groups()
tag = f"v{major}.{minor}.{patch}"
docs_version = f"v{major}.{minor}"
branch = f"docs/{docs_version}"

versions = json.loads(manifest.read_text())
if not isinstance(versions, list):
    raise SystemExit("supported versions must be a list")

latest = next((item for item in versions if item.get("version") == "latest"), None)
if latest is None:
    raise SystemExit("supported versions must contain a latest entry")

updated = [
    {
        "version": docs_version,
        "ref": branch,
        "path": f"/{docs_version}/",
        "release": tag,
        "isCurrent": True,
    },
    {
        **latest,
        "version": "latest",
        "ref": "main",
        "path": "/",
        "isCurrent": False,
    },
]
changed = updated != versions
if changed:
    manifest.write_text(json.dumps(updated, indent=2) + "\n")

print(
    json.dumps(
        {
            "version": tag,
            "docsVersion": docs_version,
            "branch": branch,
            "changed": changed,
        },
        separators=(",", ":"),
    )
)
