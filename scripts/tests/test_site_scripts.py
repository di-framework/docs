import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Optional


REPOSITORY = Path(__file__).resolve().parents[2]
PATCH_SITE = REPOSITORY / "scripts" / "patch-site.py"
ASSEMBLE_SITE = REPOSITORY / "scripts" / "assemble-site.py"


def write_build(builds: Path, version: str, product_version: Optional[str] = None) -> None:
    output = builds / version
    output.mkdir(parents=True)
    (output / "config.json").write_text(
        json.dumps({"productVersion": product_version or version})
    )
    (output / "overview.html").write_text(f"<html><title>{version}</title></html>")


class PatchSiteTests(unittest.TestCase):
    def test_sets_the_active_product_version_and_scoped_search_endpoint(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            site = Path(directory)
            (site / "config.json").write_text(json.dumps({"productVersion": "latest"}))
            (site / "overview.html").write_text("<html><head></head><body></body></html>")

            subprocess.run(
                [
                    sys.executable,
                    PATCH_SITE,
                    site,
                    "v5.0",
                    "https://search.example.test/base/",
                ],
                check=True,
            )

            config = json.loads((site / "config.json").read_text())
            self.assertEqual(config["productVersion"], "v5.0")
            self.assertEqual(
                config["searchServiceUrl"],
                "https://search.example.test/base/preview-search/Writerside/d/v5.0",
            )


class AssembleSiteTests(unittest.TestCase):
    def run_assemble(self, root: Path, manifest_data: list[dict[str, str]]):
        builds = root / "builds"
        site = root / "site"
        manifest = root / "supported-versions.json"
        manifest.write_text(json.dumps(manifest_data))
        return subprocess.run(
            [sys.executable, ASSEMBLE_SITE, builds, site, manifest],
            cwd=root,
            capture_output=True,
            text=True,
        )

    def test_publishes_oldest_to_current_with_one_current_version(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builds = root / "builds"
            write_build(builds, "v5.0")
            write_build(builds, "latest")

            result = self.run_assemble(
                root,
                [
                    {"version": "v5.0", "ref": "docs/v5.0", "path": "/v5.0/"},
                    {"version": "latest", "ref": "main", "path": "/"},
                ],
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            versions = json.loads((root / "site" / "versions.json").read_text())
            self.assertEqual(
                versions,
                [
                    {"version": "v5.0", "url": "/v5.0/", "isCurrent": False},
                    {"version": "latest", "url": "/", "isCurrent": True},
                ],
            )

    def test_rejects_latest_before_an_older_version(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = self.run_assemble(
                root,
                [
                    {"version": "latest", "ref": "main", "path": "/"},
                    {"version": "v5.0", "ref": "docs/v5.0", "path": "/v5.0/"},
                ],
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("oldest-to-current", result.stderr)

    def test_rejects_a_build_with_the_wrong_active_version(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            builds = root / "builds"
            write_build(builds, "v5.0", product_version="latest")
            write_build(builds, "latest")

            result = self.run_assemble(
                root,
                [
                    {"version": "v5.0", "ref": "docs/v5.0", "path": "/v5.0/"},
                    {"version": "latest", "ref": "main", "path": "/"},
                ],
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("declares productVersion 'latest'", result.stderr)


if __name__ == "__main__":
    unittest.main()
