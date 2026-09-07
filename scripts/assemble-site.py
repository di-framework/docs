#!/usr/bin/env python3
import json
import shutil
import sys
from pathlib import Path

builds, site, manifest = map(Path, sys.argv[1:4])
site.mkdir(parents=True, exist_ok=True)
versions = json.loads(manifest.read_text())
if not isinstance(versions, list) or not versions:
    raise SystemExit("supported versions must be a non-empty list")

version_names = [item.get("version") for item in versions]
if len(version_names) != len(set(version_names)):
    raise SystemExit("supported version names must be unique")
if version_names.count("latest") != 1:
    raise SystemExit("supported versions must contain exactly one latest entry")
if version_names[-1] != "latest":
    raise SystemExit(
        "latest must be the final supported version; Writerside expects stable "
        "versions before the rolling latest build"
    )
current_indexes = [
    index for index, item in enumerate(versions) if item.get("isCurrent") is True
]
if current_indexes != [len(versions) - 2]:
    raise SystemExit(
        "exactly one stable version immediately before latest must set isCurrent=true"
    )
if versions[-1].get("isCurrent") is not False:
    raise SystemExit("the rolling latest build must set isCurrent=false")

entries = []
for item in versions:
    version = item["version"]
    source = builds / version
    source_config = source / "config.json"
    if not source_config.is_file():
        raise SystemExit(f"missing successful build for {version}: {source}")
    cfg = json.loads(source_config.read_text())
    if cfg.get("productVersion") != version:
        raise SystemExit(
            f"built config for {version} declares productVersion "
            f"{cfg.get('productVersion')!r}"
        )
    target = site if version == "latest" else site / version
    shutil.copytree(source, target, dirs_exist_ok=True)
    if version == "latest":
        shutil.copytree(source, site / "latest", dirs_exist_ok=True)
    entries.append({
        "version": version,
        "url": item["path"],
        "isCurrent": item["isCurrent"],
    })
(site / "versions.json").write_text(json.dumps(entries, indent=2) + "\n")

coverage_dir = Path("coverage")
if coverage_dir.is_dir():
    shutil.copytree(coverage_dir, site / "coverage", dirs_exist_ok=True)
