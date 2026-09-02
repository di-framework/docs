#!/usr/bin/env python3
import json
import shutil
import sys
from pathlib import Path

builds, site, manifest = map(Path, sys.argv[1:4])
site.mkdir(parents=True, exist_ok=True)
versions = json.loads(manifest.read_text())
entries = []
for item in versions:
    version = item["version"]
    source = builds / version
    if not (source / "config.json").is_file():
        raise SystemExit(f"missing successful build for {version}: {source}")
    target = site if version == "latest" else site / version
    shutil.copytree(source, target, dirs_exist_ok=True)
    if version == "latest":
        shutil.copytree(source, site / "latest", dirs_exist_ok=True)
    entries.append({
        "version": version,
        "url": item["path"],
        "isCurrent": version == "latest",
    })
(site / "versions.json").write_text(json.dumps(entries, indent=2) + "\n")

coverage_dir = Path("coverage")
if coverage_dir.is_dir():
    shutil.copytree(coverage_dir, site / "coverage", dirs_exist_ok=True)
